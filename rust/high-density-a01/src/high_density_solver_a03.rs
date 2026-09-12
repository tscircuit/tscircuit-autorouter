#![allow(non_snake_case)]

type InitialPenaltyFn = Box<dyn Fn(&Value) -> f64>;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const REGION_LEFT: usize = 0;
const REGION_TOP: usize = 1;
const REGION_RIGHT: usize = 2;
const REGION_BOTTOM: usize = 3;
const REGION_MIDDLE: usize = 4;
const REGION_NAMES: [&str; 5] = ["left", "top", "right", "bottom", "middle"];

#[derive(Clone, Default)]
struct RegionDef {
    id: usize,
    fineOriginRow: usize,
    fineOriginCol: usize,
    fineRows: usize,
    fineCols: usize,
    cellScale: usize,
    rows: usize,
    cols: usize,
    offset: usize,
}

#[derive(Clone)]
struct ConnectionSeg {
    connId: usize,
    startZ: usize,
    startCellId: usize,
    startPoint: Value,
    endZ: usize,
    endCellId: usize,
    endPoint: Value,
}

#[derive(Clone)]
struct SolvedRouteInternal {
    states: Vec<usize>,
    viaCellIds: Vec<usize>,
    startPoint: Value,
    endPoint: Value,
}

#[derive(Clone, Copy, Default)]
struct HeapEntry {
    f: f64,
    seq: u32,
    id: usize,
}

#[derive(Default)]
struct TypedMinHeap {
    entries: Vec<HeapEntry>,
    n: usize,
}

impl TypedMinHeap {
    fn push(&mut self, f: f64, seq: u32, id: usize) {
        if self.n == self.entries.len() {
            let next = (self.entries.len() * 2).max(1024);
            self.entries.resize(next, HeapEntry::default());
        }
        let mut i = self.n;
        self.n += 1;
        self.entries[i] = HeapEntry { f, seq, id };
        let held = self.entries[i];
        while i > 0 {
            let p = (i - 1) >> 1;
            let parent = self.entries[p];
            if self.less(parent, held) {
                break;
            }
            self.entries[i] = parent;
            i = p;
        }
        self.entries[i] = held;
    }

    fn pop(&mut self) -> usize {
        let out = self.entries[0].id;
        self.n -= 1;
        if self.n > 0 {
            self.entries[0] = self.entries[self.n];
            let mut i = 0;
            let held = self.entries[0];
            loop {
                let l = i * 2 + 1;
                let r = l + 1;
                if l >= self.n {
                    break;
                }
                let mut m = l;
                if r < self.n && !self.less(self.entries[l], self.entries[r]) {
                    m = r;
                }
                if self.less(held, self.entries[m]) {
                    break;
                }
                self.entries[i] = self.entries[m];
                i = m;
            }
            self.entries[i] = held;
        }
        out
    }

    #[inline(always)]
    fn less(&self, first: HeapEntry, second: HeapEntry) -> bool {
        let fi = first.f;
        let fj = second.f;
        if fi != fj {
            return fi < fj;
        }
        first.seq < second.seq
    }
}

#[derive(Default)]
struct TypedNodePool {
    z: Vec<usize>,
    cellId: Vec<usize>,
    g: Vec<f64>,
    parent: Vec<i32>,
    ripHead: Vec<i32>,
    ripCount: Vec<usize>,
    length: usize,
}

impl TypedNodePool {
    fn push(
        &mut self,
        z: usize,
        cellId: usize,
        g: f64,
        parent: i32,
        ripHead: i32,
        ripCount: usize,
    ) -> usize {
        if self.length == self.z.len() {
            let next = (self.z.len() * 2).max(1024);
            self.z.resize(next, 0);
            self.cellId.resize(next, 0);
            self.g.resize(next, 0.0);
            self.parent.resize(next, 0);
            self.ripHead.resize(next, -1);
            self.ripCount.resize(next, 0);
        }
        let idx = self.length;
        self.length += 1;
        self.z[idx] = z;
        self.cellId[idx] = cellId;
        self.g[idx] = g;
        self.parent[idx] = parent;
        self.ripHead[idx] = ripHead;
        self.ripCount[idx] = ripCount;
        idx
    }
}

#[derive(Default)]
struct TypedRipChain {
    connId: Vec<usize>,
    prev: Vec<i32>,
    length: usize,
}

impl TypedRipChain {
    fn append(&mut self, prevHead: i32, connId: usize) -> i32 {
        if self.length == self.connId.len() {
            let next = (self.connId.len() * 2).max(1024);
            self.connId.resize(next, 0);
            self.prev.resize(next, -1);
        }
        let idx = self.length;
        self.length += 1;
        self.connId[idx] = connId;
        self.prev[idx] = prevHead;
        idx as i32
    }

    fn contains(&self, mut head: i32, connId: usize) -> bool {
        while head >= 0 {
            if self.connId[head as usize] == connId {
                return true;
            }
            head = self.prev[head as usize];
        }
        false
    }

    fn collect(&self, mut head: i32) -> Vec<usize> {
        let mut out = Vec::new();
        while head >= 0 {
            out.push(self.connId[head as usize]);
            head = self.prev[head as usize];
        }
        out
    }
}

fn number(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    min.max(max.min(value))
}

fn pushUnique(arr: &mut Vec<usize>, value: usize) {
    if !arr.contains(&value) {
        arr.push(value);
    }
}

fn circleIntersectsRect(
    cx: f64,
    cy: f64,
    r: f64,
    minX: f64,
    minY: f64,
    maxX: f64,
    maxY: f64,
) -> bool {
    let dx = cx - clamp(cx, minX, maxX);
    let dy = cy - clamp(cy, minY, maxY);
    dx * dx + dy * dy <= r * r
}

// The primary owner and optional shared owners are read together for each cell.
#[derive(Clone)]
struct CellOccupants {
    primary: i32,
    #[expect(
        clippy::box_collection,
        reason = "Keep the common single-occupant cell at eight bytes on WASM."
    )]
    shared: Option<Box<Vec<usize>>>,
}

impl Default for CellOccupants {
    fn default() -> Self {
        Self {
            primary: -1,
            shared: None,
        }
    }
}

#[cfg(target_arch = "wasm32")]
const _: () = assert!(std::mem::size_of::<CellOccupants>() == 8);

#[derive(Default)]
struct OccupantMembership {
    stamps: Vec<u32>,
    generation: u32,
}

impl OccupantMembership {
    fn begin(&mut self, connection_count: usize) {
        self.stamps.resize(connection_count, 0);
        if self.generation == u32::MAX {
            self.stamps.fill(0);
            self.generation = 1;
        } else {
            self.generation += 1;
        }
    }

    fn push(&mut self, out: &mut Vec<usize>, id: usize) {
        if self.stamps[id] == self.generation {
            return;
        }
        self.stamps[id] = self.generation;
        out.push(id);
    }
}

#[derive(Default)]
pub struct HighDensitySolverA03 {
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub max_iterations: usize,
    pub progress: f64,
    pub stats: Value,
    // WASM uses the host Math.hypot so platform-specific rounding preserves search ties.
    pub hypot: Option<fn(f64, f64) -> f64>,
    pub initial_penalty_fn: Option<InitialPenaltyFn>,
    nodeWithPortPoints: Value,
    penaltyMap: Value,
    highResolutionCellSize: f64,
    lowResolutionCellSize: f64,
    viaDiameter: f64,
    traceThickness: f64,
    traceMargin: f64,
    viaMinDistFromBorder: f64,
    effort: f64,
    ripCost: f64,
    ripTracePenalty: f64,
    ripViaPenalty: f64,
    viaBaseCost: f64,
    greedyMultiplier: f64,
    boundsMinX: f64,
    boundsMaxX: f64,
    boundsMinY: f64,
    boundsMaxY: f64,
    traceKeepoutRadius: f64,
    viaKeepoutRadius: f64,
    penaltyCap: f64,
    _moveCost: f64,
    highResolutionCellThickness: usize,
    stepMultiplier: usize,
    MAX_RIPS: usize,
    fineRows: usize,
    fineCols: usize,
    lowScale: usize,
    bandRows: usize,
    bandCols: usize,
    planeSize: usize,
    layers: usize,
    ripStateBuckets: usize,
    totalRipEvents: usize,
    searchIterations: usize,
    consecutiveSkips: usize,
    baseSearchBudgetIters: usize,
    _moveRipCount: usize,
    moveOccupants: Vec<usize>,
    moveOccupantMembership: OccupantMembership,
    moveCells: Vec<usize>,
    shuffleSeed: u32,
    stamp: u32,
    seqCounter: u32,
    showPenaltyMap: bool,
    showUsedCellMap: bool,
    maxCellCount: Option<usize>,
    availableZ: Vec<f64>,
    cellCenterX: Vec<f64>,
    cellCenterY: Vec<f64>,
    cellMinX: Vec<f64>,
    cellMinY: Vec<f64>,
    cellMaxX: Vec<f64>,
    cellMaxY: Vec<f64>,
    cellWidth: Vec<f64>,
    cellHeight: Vec<f64>,
    penalty2d: Vec<f64>,
    bestGValue: Vec<f64>,
    cellRegion: Vec<usize>,
    cellRow: Vec<usize>,
    cellCol: Vec<usize>,
    neighborOffset: Vec<usize>,
    neighborIds: Vec<usize>,
    ripCount: Vec<usize>,
    viaAllowed: Vec<u8>,
    sharedCrossRootPortFlat: Vec<u8>,
    visitedStamp: Vec<u32>,
    bestGStamp: Vec<u32>,
    visitedFlatStamp: Vec<u32>,
    cellOccupants: Vec<CellOccupants>,
    portOwnerFlat: Vec<i32>,

    usedIndicesByConn: Vec<Option<Vec<usize>>>,
    regions: Vec<RegionDef>,
    neighborCosts: Vec<f32>,
    connNameToId: HashMap<String, usize>,
    connIdToName: Vec<String>,
    connIdToRootNet: Vec<String>,
    rootNetNameToId: HashMap<String, usize>,
    connIdToRootNetId: Vec<usize>,
    overlapFriendlyRootNets: HashSet<String>,
    unsolvedSegs: Vec<ConnectionSeg>,
    solvedRoutes: Vec<Option<Vec<SolvedRouteInternal>>>,
    activeConnSeg: Option<ConnectionSeg>,
    activeConnId: i32,
    _moveRippedHead: i32,
    nodePool: TypedNodePool,
    heap: TypedMinHeap,
    ripChain: TypedRipChain,
    gridToBoundsTransform: [f64; 6],
}

impl HighDensitySolverA03 {
    pub fn new(props: Value) -> Self {
        let hp = &props["hyperParameters"];
        Self {
            nodeWithPortPoints: props["nodeWithPortPoints"].clone(),
            highResolutionCellSize: number(&props, "highResolutionCellSize", 0.1),
            highResolutionCellThickness: number(&props, "highResolutionCellThickness", 8.0)
                .floor()
                .max(1.0) as usize,
            lowResolutionCellSize: number(&props, "lowResolutionCellSize", 0.4),
            viaDiameter: props["viaDiameter"]
                .as_f64()
                .expect("viaDiameter is required"),
            maxCellCount: props["maxCellCount"].as_u64().map(|n| n as usize),
            traceThickness: number(&props, "traceThickness", 0.1),
            traceMargin: number(&props, "traceMargin", 0.15),
            viaMinDistFromBorder: number(&props, "viaMinDistFromBorder", 0.15),
            showPenaltyMap: props["showPenaltyMap"].as_bool().unwrap_or(false),
            showUsedCellMap: props["showUsedCellMap"].as_bool().unwrap_or(false),
            effort: number(&props, "effort", 1.0),
            stepMultiplier: number(&props, "stepMultiplier", 1.0).floor().max(1.0) as usize,
            shuffleSeed: number(hp, "shuffleSeed", 0.0) as i64 as u32,
            ripCost: number(hp, "ripCost", 8.0),
            ripTracePenalty: number(hp, "ripTracePenalty", 0.5),
            ripViaPenalty: number(hp, "ripViaPenalty", 0.75),
            viaBaseCost: number(hp, "viaBaseCost", 0.1),
            greedyMultiplier: number(hp, "greedyMultiplier", 1.5),
            max_iterations: number(&props, "maxIterations", 100e6) as usize,
            MAX_RIPS: 200,
            penaltyMap: props["penaltyMap"].clone(),
            activeConnId: -1,
            _moveRippedHead: -1,
            stats: json!({}),
            ..Self::default()
        }
    }

    pub fn setup(&mut self) {
        let width = self.nodeWithPortPoints["width"]
            .as_f64()
            .expect("width is required");
        let height = self.nodeWithPortPoints["height"]
            .as_f64()
            .expect("height is required");
        let cx = self.nodeWithPortPoints["center"]["x"]
            .as_f64()
            .expect("center.x is required");
        let cy = self.nodeWithPortPoints["center"]["y"]
            .as_f64()
            .expect("center.y is required");
        let rawScale = self.lowResolutionCellSize / self.highResolutionCellSize;
        let roundedScale = (rawScale + 0.5).floor();
        if !rawScale.is_finite() || rawScale <= 0.0 || (rawScale - roundedScale).abs() > 1e-9 {
            self.error = Some("lowResolutionCellSize must be a positive integer multiple of highResolutionCellSize".into());
            self.failed = true;
            return;
        }
        self.lowScale = roundedScale.max(1.0) as usize;
        let points = self.nodeWithPortPoints["portPoints"]
            .as_array()
            .expect("portPoints is required")
            .clone();
        self.availableZ = if let Some(zs) = self.nodeWithPortPoints["availableZ"].as_array() {
            zs.iter()
                .map(|z| z.as_f64().expect("availableZ must be numeric"))
                .collect()
        } else {
            let mut zs = Vec::new();
            for pp in &points {
                let z = pp["z"].as_f64().expect("port z is required");
                if !zs.contains(&z) {
                    zs.push(z);
                }
            }
            zs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            zs
        };
        self.layers = self.availableZ.len();
        self.boundsMinX = cx - width / 2.0;
        self.boundsMaxX = cx + width / 2.0;
        self.boundsMinY = cy - height / 2.0;
        self.boundsMaxY = cy + height / 2.0;
        self.traceKeepoutRadius = self.traceMargin + self.traceThickness / 2.0;
        self.viaKeepoutRadius = self.viaDiameter / 2.0 + self.traceKeepoutRadius;
        self.buildFiveRegionGrid(width, height);
        self.gridToBoundsTransform = self.computeGridToBoundsTransform();
        let totalCells = self.layers * self.planeSize;
        if let Some(max) = self.maxCellCount
            && totalCells > max
        {
            self.error = Some(format!(
                "Cell count {totalCells} exceeds maxCellCount {max}"
            ));
            self.failed = true;
            return;
        }
        self.connNameToId.clear();
        self.connIdToName.clear();
        self.connIdToRootNet.clear();
        self.rootNetNameToId.clear();
        self.connIdToRootNetId.clear();
        self.overlapFriendlyRootNets.clear();
        self.unsolvedSegs = self.buildConnectionSegs();
        self.penalty2d = vec![0.0; self.planeSize];
        if let Some(penalties) = self.penaltyMap.as_array() {
            assert_eq!(
                penalties.len(),
                self.planeSize,
                "penaltyMap must match cell count"
            );
            for (i, penalty) in penalties.iter().enumerate() {
                self.penalty2d[i] = penalty.as_f64().expect("penaltyMap must be numeric");
            }
        }
        if let Some(initialPenaltyFn) = &self.initial_penalty_fn {
            let widthInv = if width > 0.0 { 1.0 / width } else { 0.0 };
            let heightInv = if height > 0.0 { 1.0 / height } else { 0.0 };
            for cellId in 0..self.planeSize {
                self.penalty2d[cellId] += initialPenaltyFn(&json!({
                    "x": self.cellCenterX[cellId], "y": self.cellCenterY[cellId],
                    "px": (self.cellCenterX[cellId] - self.boundsMinX) * widthInv,
                    "py": (self.cellCenterY[cellId] - self.boundsMinY) * heightInv,
                    "cellId": cellId, "region": REGION_NAMES[self.cellRegion[cellId]],
                    "row": self.cellRow[cellId], "col": self.cellCol[cellId],
                }));
            }
        }
        self.cellOccupants = vec![CellOccupants::default(); totalCells];
        self.portOwnerFlat = vec![-1; totalCells];
        self.sharedCrossRootPortFlat = vec![0; totalCells];
        self.ripStateBuckets = 1;
        self.visitedStamp = vec![0; totalCells];
        self.bestGStamp = vec![0; totalCells];
        self.bestGValue = vec![0.0; totalCells];
        self.visitedFlatStamp = vec![0; totalCells];
        self.stamp = 0;
        let mut rootByPortFlat = HashMap::<usize, String>::new();
        for pp in &points {
            let name = pp["connectionName"]
                .as_str()
                .expect("connectionName is required");
            let Some(&connId) = self.connNameToId.get(name) else {
                continue;
            };
            let (z, cellId) = self.pointToCell(pp);
            let flatIdx = z * self.planeSize + cellId;
            let rootNet = &self.connIdToRootNet[connId];
            if let Some(existingRoot) = rootByPortFlat.get(&flatIdx) {
                if existingRoot != rootNet {
                    self.sharedCrossRootPortFlat[flatIdx] = 1;
                }
            } else {
                rootByPortFlat.insert(flatIdx, rootNet.clone());
            }
            let existing = self.portOwnerFlat[flatIdx];
            self.portOwnerFlat[flatIdx] = if existing == -1 || existing == connId as i32 {
                connId as i32
            } else {
                -2
            };
        }
        self.solvedRoutes.clear();
        self.usedIndicesByConn.clear();
        self.ripCount.clear();
        self.consecutiveSkips = 0;
        self.penaltyCap = self.ripCost * 0.5;
        self.shuffleConnections();
        use crate::max_iterations_by_node_size_and_connection_count::{
            MaxIterationsByNodeSizeAndConnectionCountInput,
            compute_max_iterations_by_node_size_and_connection_count,
        };
        let budget = compute_max_iterations_by_node_size_and_connection_count(
            MaxIterationsByNodeSizeAndConnectionCountInput {
                plane_size: self.planeSize as f64,
                layers: self.layers as f64,
                connection_count: self.unsolvedSegs.len() as f64,
                effort: self.effort,
                max_iterations: self.max_iterations as f64,
            },
        );
        self.baseSearchBudgetIters = budget.base_search_budget_iters as usize;
        self.max_iterations = budget.max_iterations_iters as usize;
        self.activeConnSeg = None;
        self.activeConnId = -1;
        self.nodePool = TypedNodePool::default();
        self.heap = TypedMinHeap::default();
        self.ripChain = TypedRipChain::default();
        self.seqCounter = 0;
    }

    pub fn step(&mut self) {
        for _ in 0..self.stepMultiplier {
            if self.solved || self.failed {
                return;
            }
            self.stepOnce();
        }
    }

    fn buildFiveRegionGrid(&mut self, width: f64, height: f64) {
        self.fineCols = (width / self.highResolutionCellSize).ceil().max(1.0) as usize;
        self.fineRows = (height / self.highResolutionCellSize).ceil().max(1.0) as usize;
        self.bandCols = self.highResolutionCellThickness.min(self.fineCols / 2);
        self.bandRows = self.highResolutionCellThickness.min(self.fineRows / 2);
        let middleFineCols = self.fineCols - self.bandCols * 2;
        let middleFineRows = self.fineRows - self.bandRows * 2;
        self.regions = vec![
            RegionDef {
                id: REGION_LEFT,
                fineOriginRow: 0,
                fineOriginCol: 0,
                fineRows: self.fineRows,
                fineCols: self.bandCols,
                cellScale: 1,
                rows: self.fineRows,
                cols: self.bandCols,
                offset: 0,
            },
            RegionDef {
                id: REGION_TOP,
                fineOriginRow: 0,
                fineOriginCol: self.bandCols,
                fineRows: self.bandRows,
                fineCols: middleFineCols,
                cellScale: 1,
                rows: self.bandRows,
                cols: middleFineCols,
                offset: 0,
            },
            RegionDef {
                id: REGION_RIGHT,
                fineOriginRow: 0,
                fineOriginCol: self.fineCols - self.bandCols,
                fineRows: self.fineRows,
                fineCols: self.bandCols,
                cellScale: 1,
                rows: self.fineRows,
                cols: self.bandCols,
                offset: 0,
            },
            RegionDef {
                id: REGION_BOTTOM,
                fineOriginRow: self.fineRows - self.bandRows,
                fineOriginCol: self.bandCols,
                fineRows: self.bandRows,
                fineCols: middleFineCols,
                cellScale: 1,
                rows: self.bandRows,
                cols: middleFineCols,
                offset: 0,
            },
            RegionDef {
                id: REGION_MIDDLE,
                fineOriginRow: self.bandRows,
                fineOriginCol: self.bandCols,
                fineRows: middleFineRows,
                fineCols: middleFineCols,
                cellScale: self.lowScale,
                rows: middleFineRows.div_ceil(self.lowScale),
                cols: middleFineCols.div_ceil(self.lowScale),
                offset: 0,
            },
        ];
        let mut offset = 0;
        for region in &mut self.regions {
            region.offset = offset;
            offset += region.rows * region.cols;
        }
        self.planeSize = offset;
        self.cellCenterX = vec![0.0; offset];
        self.cellCenterY = vec![0.0; offset];
        self.cellMinX = vec![0.0; offset];
        self.cellMinY = vec![0.0; offset];
        self.cellMaxX = vec![0.0; offset];
        self.cellMaxY = vec![0.0; offset];
        self.cellWidth = vec![0.0; offset];
        self.cellHeight = vec![0.0; offset];
        self.cellRegion = vec![0; offset];
        self.cellRow = vec![0; offset];
        self.cellCol = vec![0; offset];
        self.viaAllowed = vec![0; offset];
        for region in &self.regions {
            for row in 0..region.rows {
                let fineRow0 = region.fineOriginRow + row * region.cellScale;
                let fineRow1 =
                    (region.fineOriginRow + region.fineRows).min(fineRow0 + region.cellScale);
                let minY = self.boundsMinY + fineRow0 as f64 * self.highResolutionCellSize;
                let maxY = self
                    .boundsMaxY
                    .min(self.boundsMinY + fineRow1 as f64 * self.highResolutionCellSize);
                for col in 0..region.cols {
                    let fineCol0 = region.fineOriginCol + col * region.cellScale;
                    let fineCol1 =
                        (region.fineOriginCol + region.fineCols).min(fineCol0 + region.cellScale);
                    let minX = self.boundsMinX + fineCol0 as f64 * self.highResolutionCellSize;
                    let maxX = self
                        .boundsMaxX
                        .min(self.boundsMinX + fineCol1 as f64 * self.highResolutionCellSize);
                    let cellId = region.offset + row * region.cols + col;
                    self.cellCenterX[cellId] = (minX + maxX) / 2.0;
                    self.cellCenterY[cellId] = (minY + maxY) / 2.0;
                    self.cellMinX[cellId] = minX;
                    self.cellMinY[cellId] = minY;
                    self.cellMaxX[cellId] = maxX;
                    self.cellMaxY[cellId] = maxY;
                    self.cellWidth[cellId] = maxX - minX;
                    self.cellHeight[cellId] = maxY - minY;
                    self.cellRegion[cellId] = region.id;
                    self.cellRow[cellId] = row;
                    self.cellCol[cellId] = col;
                    let minBorderDist = (self.cellCenterX[cellId] - self.boundsMinX)
                        .min(self.boundsMaxX - self.cellCenterX[cellId])
                        .min(self.cellCenterY[cellId] - self.boundsMinY)
                        .min(self.boundsMaxY - self.cellCenterY[cellId]);
                    self.viaAllowed[cellId] = u8::from(minBorderDist >= self.viaMinDistFromBorder);
                }
            }
        }
        let mut neighbors: Vec<Vec<(usize, f64)>> = vec![Vec::new(); self.planeSize];
        let mut addBidirectionalEdge = |a: usize, b: usize| {
            if a == b {
                return;
            }
            let dx = self.cellCenterX[a] - self.cellCenterX[b];
            let dy = self.cellCenterY[a] - self.cellCenterY[b];
            let cost = self.hypot.unwrap_or(f64::hypot)(dx, dy);
            if !neighbors[a].iter().any(|e| e.0 == b) {
                neighbors[a].push((b, cost));
            }
            if !neighbors[b].iter().any(|e| e.0 == a) {
                neighbors[b].push((a, cost));
            }
        };
        for region in &self.regions {
            for row in 0..region.rows {
                for col in 0..region.cols {
                    let cellId = self.cellIdFor(region.id, row, col);
                    if row + 1 < region.rows {
                        addBidirectionalEdge(cellId, self.cellIdFor(region.id, row + 1, col));
                    }
                    if col + 1 < region.cols {
                        addBidirectionalEdge(cellId, self.cellIdFor(region.id, row, col + 1));
                    }
                }
            }
        }
        let left = &self.regions[REGION_LEFT];
        let top = &self.regions[REGION_TOP];
        let right = &self.regions[REGION_RIGHT];
        let bottom = &self.regions[REGION_BOTTOM];
        let middle = &self.regions[REGION_MIDDLE];
        let hasLeft = left.rows > 0 && left.cols > 0;
        let hasTop = top.rows > 0 && top.cols > 0;
        let hasRight = right.rows > 0 && right.cols > 0;
        let hasBottom = bottom.rows > 0 && bottom.cols > 0;
        let hasMiddle = middle.rows > 0 && middle.cols > 0;
        if hasLeft && hasTop {
            for globalRow in 0..self.bandRows {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
                    self.cellIdFor(REGION_TOP, globalRow, 0),
                );
            }
        }
        if hasTop && hasRight {
            for globalRow in 0..self.bandRows {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_TOP, globalRow, top.cols - 1),
                    self.cellIdFor(REGION_RIGHT, globalRow, 0),
                );
            }
        }
        if hasLeft && hasBottom {
            for globalRow in self.fineRows - self.bandRows..self.fineRows {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
                    self.cellIdFor(
                        REGION_BOTTOM,
                        globalRow - (self.fineRows - self.bandRows),
                        0,
                    ),
                );
            }
        }
        if hasBottom && hasRight {
            for globalRow in self.fineRows - self.bandRows..self.fineRows {
                addBidirectionalEdge(
                    self.cellIdFor(
                        REGION_BOTTOM,
                        globalRow - (self.fineRows - self.bandRows),
                        bottom.cols - 1,
                    ),
                    self.cellIdFor(REGION_RIGHT, globalRow, 0),
                );
            }
        }
        if hasLeft && hasMiddle {
            for globalRow in self.bandRows..self.fineRows - self.bandRows {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
                    self.cellIdFor(
                        REGION_MIDDLE,
                        (globalRow - self.bandRows) / self.lowScale,
                        0,
                    ),
                );
            }
        }
        if hasRight && hasMiddle {
            for globalRow in self.bandRows..self.fineRows - self.bandRows {
                addBidirectionalEdge(
                    self.cellIdFor(
                        REGION_MIDDLE,
                        (globalRow - self.bandRows) / self.lowScale,
                        middle.cols - 1,
                    ),
                    self.cellIdFor(REGION_RIGHT, globalRow, 0),
                );
            }
        }
        if hasTop && hasMiddle {
            for globalCol in self.bandCols..self.fineCols - self.bandCols {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_TOP, top.rows - 1, globalCol - self.bandCols),
                    self.cellIdFor(
                        REGION_MIDDLE,
                        0,
                        (globalCol - self.bandCols) / self.lowScale,
                    ),
                );
            }
        }
        if hasBottom && hasMiddle {
            for globalCol in self.bandCols..self.fineCols - self.bandCols {
                addBidirectionalEdge(
                    self.cellIdFor(
                        REGION_MIDDLE,
                        middle.rows - 1,
                        (globalCol - self.bandCols) / self.lowScale,
                    ),
                    self.cellIdFor(REGION_BOTTOM, 0, globalCol - self.bandCols),
                );
            }
        }
        // Collapsed middle/edge bands leave opposing regions sharing a seam.
        if !hasMiddle && !hasTop && !hasBottom && hasLeft && hasRight {
            for row in 0..left.rows.min(right.rows) {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_LEFT, row, left.cols - 1),
                    self.cellIdFor(REGION_RIGHT, row, 0),
                );
            }
        }
        if !hasMiddle && !hasLeft && !hasRight && hasTop && hasBottom {
            for col in 0..top.cols.min(bottom.cols) {
                addBidirectionalEdge(
                    self.cellIdFor(REGION_TOP, top.rows - 1, col),
                    self.cellIdFor(REGION_BOTTOM, 0, col),
                );
            }
        }
        self.flattenNeighborLists(neighbors);
    }

    fn cellIdFor(&self, regionId: usize, row: usize, col: usize) -> usize {
        let region = &self.regions[regionId];
        region.offset + row * region.cols + col
    }
    fn stepOnce(&mut self) {
        if self.activeConnSeg.is_none() {
            if self.unsolvedSegs.is_empty() {
                self.solved = true;
                return;
            }
            let next = self.unsolvedSegs.remove(0);
            self.activeConnSeg = Some(next.clone());
            self.activeConnId = next.connId as i32;
            self.nodePool.length = 0;
            self.ripChain.length = 0;
            self.heap.n = 0;
            self.seqCounter = 0;
            self.searchIterations = 0;
            self.nextStamp();
            let h = self.computeH(next.startZ, next.startCellId, next.endZ, next.endCellId);
            let f = h * self.greedyMultiplier;
            let startIdx = self
                .nodePool
                .push(next.startZ, next.startCellId, 0.0, -1, -1, 0);
            let startFlatIdx = next.startZ * self.planeSize + next.startCellId;
            let startStateIdx = self.getSearchStateIdx(startFlatIdx, 0);
            self.bestGStamp[startStateIdx] = self.stamp;
            self.bestGValue[startStateIdx] = 0.0;
            self.heap.push(f, self.seqCounter, startIdx);
            self.seqCounter = self.seqCounter.wrapping_add(1);
            return;
        }
        self.searchIterations += 1;
        let connRips = self
            .ripCount
            .get(self.activeConnId as usize)
            .copied()
            .unwrap_or(0);
        let budget = (self.baseSearchBudgetIters as f64 * (1.0 + connRips.min(10) as f64 * 0.25)
            + 0.5)
            .floor() as usize;
        if self.searchIterations > budget {
            for p in &mut self.penalty2d {
                *p *= 0.9;
            }
            self.unsolvedSegs.push(self.activeConnSeg.take().unwrap());
            self.activeConnId = -1;
            self.heap.n = 0;
            self.nodePool.length = 0;
            self.consecutiveSkips += 1;
            if self.consecutiveSkips >= 3.max(self.unsolvedSegs.len() * 3) {
                self.error = Some(format!(
                    "Convergence failure: {} connections stuck",
                    self.unsolvedSegs.len()
                ));
                self.failed = true;
            }
            return;
        }
        if self.heap.n == 0 {
            self.error = Some(format!(
                "No path found for {}",
                self.connIdToName[self.activeConnId as usize]
            ));
            self.failed = true;
            return;
        }
        let nodeIdx = self.heap.pop();
        let z = self.nodePool.z[nodeIdx];
        let cellId = self.nodePool.cellId[nodeIdx];
        let g = self.nodePool.g[nodeIdx];
        let rippedHead = self.nodePool.ripHead[nodeIdx];
        let ripCount = self.nodePool.ripCount[nodeIdx];
        let flatIdx = z * self.planeSize + cellId;
        let searchStateIdx = self.getSearchStateIdx(flatIdx, ripCount);
        if self.visitedStamp[searchStateIdx] == self.stamp {
            return;
        }
        self.visitedStamp[searchStateIdx] = self.stamp;
        self.visitedFlatStamp[flatIdx] = self.stamp;
        let seg = self.activeConnSeg.as_ref().unwrap();
        if z == seg.endZ && cellId == seg.endCellId {
            self.finalizeRoute(nodeIdx);
            self.activeConnSeg = None;
            self.activeConnId = -1;
            return;
        }
        let stamp = self.stamp;
        let activeConn = self.activeConnId as usize;
        let endZ = seg.endZ;
        let endCellId = seg.endCellId;
        let neighborStart = self.neighborOffset[cellId];
        let neighborEnd = self.neighborOffset[cellId + 1];
        for i in neighborStart..neighborEnd {
            let neighborCellId = self.neighborIds[i];
            let nextFlatIdx = z * self.planeSize + neighborCellId;
            self.computeMoveCostAndRips(
                activeConn,
                z,
                neighborCellId,
                false,
                rippedHead,
                ripCount,
                self.neighborCosts[i] as f64,
            );
            if self._moveCost < 0.0 {
                continue;
            }
            let nextStateIdx = self.getSearchStateIdx(nextFlatIdx, self._moveRipCount);
            if self.visitedStamp[nextStateIdx] == stamp {
                continue;
            }
            let g2 = g + self._moveCost;
            if self.bestGStamp[nextStateIdx] == stamp && g2 >= self.bestGValue[nextStateIdx] {
                continue;
            }
            self.bestGStamp[nextStateIdx] = stamp;
            self.bestGValue[nextStateIdx] = g2;
            let f2 = g2 + self.computeH(z, neighborCellId, endZ, endCellId) * self.greedyMultiplier;
            let newNodeIdx = self.nodePool.push(
                z,
                neighborCellId,
                g2,
                nodeIdx as i32,
                self._moveRippedHead,
                self._moveRipCount,
            );
            self.heap.push(f2, self.seqCounter, newNodeIdx);
            self.seqCounter = self.seqCounter.wrapping_add(1);
        }
        if self.viaAllowed[cellId] != 0 {
            for nz in 0..self.layers {
                if nz == z {
                    continue;
                }
                let nextFlatIdx = nz * self.planeSize + cellId;
                self.computeMoveCostAndRips(
                    activeConn, nz, cellId, true, rippedHead, ripCount, 0.0,
                );
                if self._moveCost < 0.0 {
                    continue;
                }
                let nextStateIdx = self.getSearchStateIdx(nextFlatIdx, self._moveRipCount);
                if self.visitedStamp[nextStateIdx] == stamp {
                    continue;
                }
                let g2 = g + self._moveCost;
                if self.bestGStamp[nextStateIdx] == stamp && g2 >= self.bestGValue[nextStateIdx] {
                    continue;
                }
                self.bestGStamp[nextStateIdx] = stamp;
                self.bestGValue[nextStateIdx] = g2;
                let f2 = g2 + self.computeH(nz, cellId, endZ, endCellId) * self.greedyMultiplier;
                let newNodeIdx = self.nodePool.push(
                    nz,
                    cellId,
                    g2,
                    nodeIdx as i32,
                    self._moveRippedHead,
                    self._moveRipCount,
                );
                self.heap.push(f2, self.seqCounter, newNodeIdx);
                self.seqCounter = self.seqCounter.wrapping_add(1);
            }
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "Keep the argument list aligned with the TypeScript source."
    )]
    fn computeMoveCostAndRips(
        &mut self,
        activeConn: usize,
        toZ: usize,
        toCellId: usize,
        isVia: bool,
        rippedHead: i32,
        currentRipCount: usize,
        lateralCost: f64,
    ) {
        let mut cost = 0.0;
        let mut head = rippedHead;
        let mut ripCount = currentRipCount;
        let toFlatIdx = toZ * self.planeSize + toCellId;
        if isVia {
            cost += self.viaBaseCost;
            cost += self.penalty2d[toCellId].min(self.penaltyCap);
            let fixedOwner = self.portOwnerFlat[toFlatIdx];
            let allowFixedOverlap = self.allowSharedUse(activeConn, fixedOwner);
            let isSegEnd = self
                .activeConnSeg
                .as_ref()
                .is_some_and(|seg| toZ == seg.endZ && toCellId == seg.endCellId);
            if fixedOwner >= 0 && fixedOwner != activeConn as i32 && !allowFixedOverlap && !isSegEnd
            {
                self._moveCost = -1.0;
                self._moveRippedHead = head;
                return;
            }
            let mut occs = std::mem::take(&mut self.moveOccupants);
            let mut cells = std::mem::take(&mut self.moveCells);
            let mut membership = std::mem::take(&mut self.moveOccupantMembership);
            self.fillViaOccupants(toCellId, activeConn, &mut occs, &mut cells, &mut membership);
            for &occ in &occs {
                if !self.ripChain.contains(head, occ) {
                    cost += self.ripCost;
                    head = self.ripChain.append(head, occ);
                    ripCount += 1;
                }
                cost += self.ripViaPenalty;
            }
            self.moveOccupants = occs;
            self.moveCells = cells;
            self.moveOccupantMembership = membership;
        } else {
            cost += lateralCost;
            cost += self.penalty2d[toCellId].min(self.penaltyCap);
            let fixedOwner = self.portOwnerFlat[toFlatIdx];
            let allowFixedOverlap = self.allowSharedUse(activeConn, fixedOwner);
            let isSegEnd = self
                .activeConnSeg
                .as_ref()
                .is_some_and(|seg| toZ == seg.endZ && toCellId == seg.endCellId);
            if fixedOwner >= 0 && fixedOwner != activeConn as i32 && !allowFixedOverlap && !isSegEnd
            {
                self._moveCost = -1.0;
                self._moveRippedHead = head;
                return;
            }
            let mut occs = std::mem::take(&mut self.moveOccupants);
            occs.clear();
            let mut membership = std::mem::take(&mut self.moveOccupantMembership);
            membership.begin(self.connIdToRootNetId.len());
            self.pushFlatOccupantsWithMembership(
                toFlatIdx,
                activeConn,
                self.connIdToRootNetId[activeConn],
                &mut occs,
                &mut membership,
            );
            for &occ in &occs {
                if !self.ripChain.contains(head, occ) {
                    cost += self.ripCost;
                    head = self.ripChain.append(head, occ);
                    ripCount += 1;
                }
                cost += self.ripTracePenalty;
            }
            self.moveOccupants = occs;
            self.moveOccupantMembership = membership;
        }
        self._moveCost = cost;
        self._moveRippedHead = head;
        self._moveRipCount = ripCount;
    }

    fn fillViaOccupants(
        &self,
        cellId: usize,
        activeConn: usize,
        occs: &mut Vec<usize>,
        cells: &mut Vec<usize>,
        membership: &mut OccupantMembership,
    ) {
        occs.clear();
        membership.begin(self.connIdToRootNetId.len());
        let activeRoot = self.connIdToRootNetId[activeConn];
        let cx = self.cellCenterX[cellId];
        let cy = self.cellCenterY[cellId];
        self.cellsNearCircleInto(cx, cy, self.viaKeepoutRadius, cells);
        for &occCellId in cells.iter() {
            if !circleIntersectsRect(
                cx,
                cy,
                self.viaKeepoutRadius,
                self.cellMinX[occCellId],
                self.cellMinY[occCellId],
                self.cellMaxX[occCellId],
                self.cellMaxY[occCellId],
            ) {
                continue;
            }
            for z in 0..self.layers {
                self.pushFlatOccupantsWithMembership(
                    z * self.planeSize + occCellId,
                    activeConn,
                    activeRoot,
                    occs,
                    membership,
                );
            }
        }
    }

    fn fillTraceOccupants(&self, flatIdx: usize, activeConn: usize) -> Vec<usize> {
        let mut out = Vec::new();
        self.pushFlatOccupants(flatIdx, activeConn, &mut out);
        out
    }

    fn pushFlatOccupants(&self, flatIdx: usize, activeConn: usize, out: &mut Vec<usize>) {
        let primaryOcc = self.cellOccupants[flatIdx].primary;
        if primaryOcc != -1
            && primaryOcc != activeConn as i32
            && !self.allowSharedUse(activeConn, primaryOcc)
        {
            pushUnique(out, primaryOcc as usize);
        }
        let Some(sharedOccs) = &self.cellOccupants[flatIdx].shared else {
            return;
        };
        for &occ in sharedOccs.iter() {
            if occ == activeConn || self.allowSharedUse(activeConn, occ as i32) {
                continue;
            }
            pushUnique(out, occ);
        }
    }

    fn pushFlatOccupantsWithMembership(
        &self,
        flatIdx: usize,
        activeConn: usize,
        activeRoot: usize,
        out: &mut Vec<usize>,
        membership: &mut OccupantMembership,
    ) {
        let cell = &self.cellOccupants[flatIdx];
        let primaryOcc = cell.primary;
        if primaryOcc != -1
            && primaryOcc != activeConn as i32
            && !(primaryOcc >= 0 && self.connIdToRootNetId[primaryOcc as usize] == activeRoot)
        {
            membership.push(out, primaryOcc as usize);
        }
        let Some(sharedOccs) = &cell.shared else {
            return;
        };
        for &occ in sharedOccs.iter() {
            if occ == activeConn || self.connIdToRootNetId[occ] == activeRoot {
                continue;
            }
            membership.push(out, occ);
        }
    }

    fn addSharedOccupant(&mut self, flatIdx: usize, connId: usize) {
        if self.cellOccupants[flatIdx].primary == connId as i32 {
            return;
        }
        let sharedOccs = self.cellOccupants[flatIdx]
            .shared
            .get_or_insert_with(Box::default);
        pushUnique(sharedOccs, connId);
    }

    fn replaceOccupants(&mut self, flatIdx: usize, connId: usize) {
        self.cellOccupants[flatIdx].primary = connId as i32;
        self.cellOccupants[flatIdx].shared = None;
    }

    fn removeOccupant(&mut self, flatIdx: usize, connId: usize) {
        let cell = &mut self.cellOccupants[flatIdx];
        if cell.primary == connId as i32 {
            if let Some(sharedOccs) = &mut cell.shared
                && !sharedOccs.is_empty()
            {
                cell.primary = sharedOccs.pop().unwrap() as i32;
                if sharedOccs.is_empty() {
                    cell.shared = None;
                }
                return;
            }
            cell.primary = -1;
            return;
        }
        let Some(sharedOccs) = &mut cell.shared else {
            return;
        };
        let Some(idx) = sharedOccs.iter().position(|&id| id == connId) else {
            return;
        };
        sharedOccs.remove(idx);
        if sharedOccs.is_empty() {
            cell.shared = None;
        }
    }

    fn allowSharedUse(&self, activeConn: usize, existingConn: i32) -> bool {
        if existingConn < 0 {
            return false;
        }
        self.connIdToRootNetId[existingConn as usize] == self.connIdToRootNetId[activeConn]
    }

    fn shouldSkipFixedPortHalo(&self, flatIdx: usize, connId: usize) -> bool {
        let fixedOwner = self.portOwnerFlat[flatIdx];
        if fixedOwner == connId as i32 {
            return false;
        }
        if fixedOwner == -2 {
            return true;
        }
        if fixedOwner < 0 {
            return false;
        }
        !self.allowSharedUse(connId, fixedOwner)
    }

    fn nextStamp(&mut self) {
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.visitedStamp.fill(0);
            self.bestGStamp.fill(0);
            self.visitedFlatStamp.fill(0);
            self.stamp = 1;
        }
    }

    fn getSearchStateIdx(&self, flatIdx: usize, _ripCount: usize) -> usize {
        flatIdx
    }

    fn computeH(&self, z: usize, cellId: usize, toZ: usize, toCellId: usize) -> f64 {
        let dist = self.hypot.unwrap_or(f64::hypot)(
            self.cellCenterX[cellId] - self.cellCenterX[toCellId],
            self.cellCenterY[cellId] - self.cellCenterY[toCellId],
        );
        if z == toZ {
            return dist;
        }
        dist + self.viaBaseCost
    }

    fn internConn(&mut self, name: &str, rootNetName: Option<&str>) -> usize {
        if let Some(&existing) = self.connNameToId.get(name) {
            return existing;
        }
        let id = self.connIdToName.len();
        self.connIdToName.push(name.into());
        let root = rootNetName.map(str::to_owned).unwrap_or_else(|| {
            if let Some((prefix, suffix)) = name.rsplit_once("_mst")
                && !suffix.is_empty()
                && suffix.bytes().all(|b| b.is_ascii_digit())
            {
                return prefix.into();
            }
            name.into()
        });
        let nextRootId = self.rootNetNameToId.len();
        let rootId = *self
            .rootNetNameToId
            .entry(root.clone())
            .or_insert(nextRootId);
        self.connIdToRootNetId.push(rootId);
        self.connIdToRootNet.push(root);
        self.connNameToId.insert(name.into(), id);
        id
    }

    fn buildConnectionSegs(&mut self) -> Vec<ConnectionSeg> {
        let points = self.nodeWithPortPoints["portPoints"]
            .as_array()
            .expect("portPoints is required");
        let mut byName: Vec<(String, Vec<Value>, Option<String>)> = Vec::new();
        for pp in points {
            let name = pp["connectionName"]
                .as_str()
                .expect("connectionName is required");
            let idx = if let Some(i) = byName.iter().position(|c| c.0 == name) {
                i
            } else {
                byName.push((
                    name.into(),
                    Vec::new(),
                    pp["rootConnectionName"].as_str().map(str::to_owned),
                ));
                byName.len() - 1
            };
            byName[idx].1.push(pp.clone());
        }
        let mut segs = Vec::new();
        let mut seenSegmentKeys = HashSet::new();
        for (name, pts, rootConnectionName) in byName {
            let pointPairs =
                crate::get_connection_port_point_pairs::get_connection_port_point_pairs(&pts);
            if pointPairs.is_empty() {
                continue;
            }
            let connId = self.internConn(&name, rootConnectionName.as_deref());
            for [startPoint, endPoint] in pointPairs {
                let (startZ, startCellId) = self.pointToCell(startPoint);
                let (endZ, endCellId) = self.pointToCell(endPoint);
                let endpointA = format!("{startZ}:{startCellId}");
                let endpointB = format!("{endZ}:{endCellId}");
                let orderedEndpoints = if endpointA < endpointB {
                    format!("{endpointA}|{endpointB}")
                } else {
                    format!("{endpointB}|{endpointA}")
                };
                let netName = rootConnectionName.as_deref().unwrap_or(&name);
                let segKey = format!("{netName}|{orderedEndpoints}");
                if seenSegmentKeys.contains(&segKey) {
                    self.overlapFriendlyRootNets.insert(netName.to_owned());
                    continue;
                }
                seenSegmentKeys.insert(segKey);
                segs.push(ConnectionSeg {
                    connId,
                    startZ,
                    startCellId,
                    startPoint: startPoint.clone(),
                    endZ,
                    endCellId,
                    endPoint: endPoint.clone(),
                });
            }
        }
        segs
    }

    fn pointToCell(&self, pt: &Value) -> (usize, usize) {
        let x = pt["x"].as_f64().expect("point.x is required");
        let y = pt["y"].as_f64().expect("point.y is required");
        let z = pt["z"].as_f64().expect("point.z is required");
        let fineCol = clamp(
            ((x - self.boundsMinX) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineCols - 1) as f64,
        ) as usize;
        let fineRow = clamp(
            ((y - self.boundsMinY) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineRows - 1) as f64,
        ) as usize;
        let regionId = if fineCol < self.bandCols {
            REGION_LEFT
        } else if fineCol >= self.fineCols - self.bandCols {
            REGION_RIGHT
        } else if fineRow < self.bandRows {
            REGION_TOP
        } else if fineRow >= self.fineRows - self.bandRows {
            REGION_BOTTOM
        } else {
            REGION_MIDDLE
        };
        let region = &self.regions[regionId];
        let localFineRow = fineRow as f64 - region.fineOriginRow as f64;
        let localFineCol = fineCol as f64 - region.fineOriginCol as f64;
        let row = clamp(
            (localFineRow / region.cellScale as f64).floor(),
            0.0,
            region.rows.saturating_sub(1) as f64,
        ) as usize;
        let col = clamp(
            (localFineCol / region.cellScale as f64).floor(),
            0.0,
            region.cols.saturating_sub(1) as f64,
        ) as usize;
        (
            self.availableZ.iter().rposition(|&v| v == z).unwrap_or(0),
            self.cellIdFor(regionId, row, col),
        )
    }

    fn shuffleConnections(&mut self) {
        let mut s = self.shuffleSeed;
        for i in (1..self.unsolvedSegs.len()).rev() {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            let rng = s as f64 / 0xffffffffu32 as f64;
            let j = (rng * (i + 1) as f64).floor() as usize;
            self.unsolvedSegs.swap(i, j);
        }
    }
    fn finalizeRoute(&mut self, goalNodeIdx: usize) {
        self.consecutiveSkips = self.consecutiveSkips.saturating_sub(1);
        let mut states = Vec::new();
        let mut idx = goalNodeIdx as i32;
        while idx >= 0 {
            let z = self.nodePool.z[idx as usize];
            let cellId = self.nodePool.cellId[idx as usize];
            states.push(z * self.planeSize + cellId);
            idx = self.nodePool.parent[idx as usize];
        }
        states.reverse();
        while states.len() > 1 {
            if self.sharedCrossRootPortFlat[states[0]] == 0 {
                break;
            }
            states.remove(0);
        }
        while states.len() > 1 {
            if self.sharedCrossRootPortFlat[*states.last().unwrap()] == 0 {
                break;
            }
            states.pop();
        }
        let viaCellIds = self.extractViaCellIds(&states);
        let connId = self.activeConnId as usize;
        let rippedIds = self.ripChain.collect(self.nodePool.ripHead[goalNodeIdx]);
        for &id in &rippedIds {
            self.ripTrace(id);
            if self.failed {
                return;
            }
        }
        let mut indices = Vec::new();
        for &state in &states {
            let z = state / self.planeSize;
            let cellId = state - z * self.planeSize;
            self.markTraceFootprint(connId, z, cellId, &mut indices);
        }
        let mut displacedByVias = Vec::new();
        for &cellId in &viaCellIds {
            self.markViaFootprint(connId, cellId, &mut indices, &mut displacedByVias);
        }
        if self.usedIndicesByConn.len() <= connId {
            self.usedIndicesByConn.resize(connId + 1, None);
        }
        self.usedIndicesByConn[connId]
            .get_or_insert_with(Vec::new)
            .extend(indices);
        if self.solvedRoutes.len() <= connId {
            self.solvedRoutes.resize(connId + 1, None);
        }
        let seg = self.activeConnSeg.as_ref().unwrap();
        self.solvedRoutes[connId]
            .get_or_insert_with(Vec::new)
            .push(SolvedRouteInternal {
                states,
                viaCellIds,
                startPoint: seg.startPoint.clone(),
                endPoint: seg.endPoint.clone(),
            });
        for &id in &displacedByVias {
            self.ripTrace(id);
            if self.failed {
                return;
            }
        }
        if !rippedIds.is_empty() || !displacedByVias.is_empty() {
            if self.totalRipEvents > 50 {
                for p in &mut self.penalty2d {
                    *p *= 0.99;
                }
            } else {
                for p in &mut self.penalty2d {
                    if *p > self.penaltyCap {
                        *p *= 0.5;
                    }
                }
            }
        }
    }

    fn extractViaCellIds(&self, states: &[usize]) -> Vec<usize> {
        let mut viaCellIds = Vec::new();
        for i in 1..states.len() {
            let prevZ = states[i - 1] / self.planeSize;
            let nextZ = states[i] / self.planeSize;
            if prevZ != nextZ {
                viaCellIds.push(states[i] - nextZ * self.planeSize);
            }
        }
        viaCellIds
    }

    fn markTraceFootprint(
        &mut self,
        connId: usize,
        z: usize,
        sourceCellId: usize,
        indices: &mut Vec<usize>,
    ) {
        let cx = self.cellCenterX[sourceCellId];
        let cy = self.cellCenterY[sourceCellId];
        for cellId in self.cellsNearCircle(cx, cy, self.traceKeepoutRadius) {
            if !circleIntersectsRect(
                cx,
                cy,
                self.traceKeepoutRadius,
                self.cellMinX[cellId],
                self.cellMinY[cellId],
                self.cellMaxX[cellId],
                self.cellMaxY[cellId],
            ) {
                continue;
            }
            let flatIdx = z * self.planeSize + cellId;
            if cellId != sourceCellId && self.shouldSkipFixedPortHalo(flatIdx, connId) {
                continue;
            }
            let existing = self.cellOccupants[flatIdx].primary;
            let allowSameRootOverlap = self.allowSharedUse(connId, existing);
            if existing != -1 && existing != connId as i32 && !allowSameRootOverlap {
                continue;
            }
            if existing != -1 && existing != connId as i32 {
                self.addSharedOccupant(flatIdx, connId);
            } else {
                self.cellOccupants[flatIdx].primary = connId as i32;
            }
            indices.push(flatIdx);
        }
    }

    fn markViaFootprint(
        &mut self,
        connId: usize,
        sourceCellId: usize,
        indices: &mut Vec<usize>,
        displacedByVias: &mut Vec<usize>,
    ) {
        let cx = self.cellCenterX[sourceCellId];
        let cy = self.cellCenterY[sourceCellId];
        for cellId in self.cellsNearCircle(cx, cy, self.viaKeepoutRadius) {
            if !circleIntersectsRect(
                cx,
                cy,
                self.viaKeepoutRadius,
                self.cellMinX[cellId],
                self.cellMinY[cellId],
                self.cellMaxX[cellId],
                self.cellMaxY[cellId],
            ) {
                continue;
            }
            for z in 0..self.layers {
                let flatIdx = z * self.planeSize + cellId;
                if cellId != sourceCellId && self.shouldSkipFixedPortHalo(flatIdx, connId) {
                    continue;
                }
                let occs = self.fillTraceOccupants(flatIdx, connId);
                if !occs.is_empty() {
                    for id in occs {
                        pushUnique(displacedByVias, id);
                    }
                    self.replaceOccupants(flatIdx, connId);
                    indices.push(flatIdx);
                    continue;
                }
                let existing = self.cellOccupants[flatIdx].primary;
                if existing != -1 && existing != connId as i32 {
                    self.addSharedOccupant(flatIdx, connId);
                } else {
                    self.cellOccupants[flatIdx].primary = connId as i32;
                }
                indices.push(flatIdx);
            }
        }
    }

    fn cellsNearCircle(&self, cx: f64, cy: f64, radius: f64) -> Vec<usize> {
        let mut cells = Vec::new();
        self.cellsNearCircleInto(cx, cy, radius, &mut cells);
        cells
    }

    fn cellsNearCircleInto(&self, cx: f64, cy: f64, radius: f64, cells: &mut Vec<usize>) {
        cells.clear();
        let minFineCol = clamp(
            ((cx - radius - self.boundsMinX) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineCols - 1) as f64,
        ) as usize;
        let maxFineCol = clamp(
            ((cx + radius - self.boundsMinX) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineCols - 1) as f64,
        ) as usize;
        let minFineRow = clamp(
            ((cy - radius - self.boundsMinY) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineRows - 1) as f64,
        ) as usize;
        let maxFineRow = clamp(
            ((cy + radius - self.boundsMinY) / self.highResolutionCellSize).floor(),
            0.0,
            (self.fineRows - 1) as f64,
        ) as usize;
        for region in &self.regions {
            if region.rows == 0 || region.cols == 0 {
                continue;
            }
            let regionFineRowMin = minFineRow.max(region.fineOriginRow);
            let regionFineRowMax = maxFineRow.min(region.fineOriginRow + region.fineRows - 1);
            let regionFineColMin = minFineCol.max(region.fineOriginCol);
            let regionFineColMax = maxFineCol.min(region.fineOriginCol + region.fineCols - 1);
            if regionFineRowMin > regionFineRowMax || regionFineColMin > regionFineColMax {
                continue;
            }
            let localRowMin = (regionFineRowMin - region.fineOriginRow) / region.cellScale;
            let localRowMax = (regionFineRowMax - region.fineOriginRow) / region.cellScale;
            let localColMin = (regionFineColMin - region.fineOriginCol) / region.cellScale;
            let localColMax = (regionFineColMax - region.fineOriginCol) / region.cellScale;
            for row in localRowMin..=localRowMax {
                for col in localColMin..=localColMax {
                    cells.push(self.cellIdFor(region.id, row, col));
                }
            }
        }
    }

    fn ripTrace(&mut self, connId: usize) {
        if self.ripCount.len() <= connId {
            self.ripCount.resize(connId + 1, 0);
        }
        self.ripCount[connId] += 1;
        self.totalRipEvents += 1;
        if self.totalRipEvents >= self.MAX_RIPS {
            self.error = Some(format!(
                "Convergence failure: exceeded MAX_RIPS {}",
                self.MAX_RIPS
            ));
            self.failed = true;
            return;
        }
        let routes = self.getSolvedRoutesForConn(connId).to_vec();
        for route in &routes {
            for &state in &route.states {
                let cellId = state % self.planeSize;
                self.penalty2d[cellId] += self.ripTracePenalty;
            }
            for &cellId in &route.viaCellIds {
                self.penalty2d[cellId] += self.ripViaPenalty;
            }
        }
        if let Some(indices) = self
            .usedIndicesByConn
            .get_mut(connId)
            .and_then(Option::take)
        {
            for idx in indices {
                self.removeOccupant(idx, connId);
            }
        }
        if !routes.is_empty() {
            self.solvedRoutes[connId] = None;
            for route in routes {
                let first = route.states[0];
                let last = *route.states.last().unwrap();
                let startZ = first / self.planeSize;
                let endZ = last / self.planeSize;
                self.unsolvedSegs.push(ConnectionSeg {
                    connId,
                    startZ,
                    startCellId: first - startZ * self.planeSize,
                    startPoint: route.startPoint,
                    endZ,
                    endCellId: last - endZ * self.planeSize,
                    endPoint: route.endPoint,
                });
            }
        }
    }

    fn flattenNeighborLists(&mut self, neighbors: Vec<Vec<(usize, f64)>>) {
        self.neighborOffset = vec![0; neighbors.len() + 1];
        let mut total = 0;
        for (i, edges) in neighbors.iter().enumerate() {
            self.neighborOffset[i] = total;
            total += edges.len();
        }
        self.neighborOffset[neighbors.len()] = total;
        self.neighborIds = vec![0; total];
        self.neighborCosts = vec![0.0; total];
        let mut cursor = 0;
        for edges in neighbors {
            for (cellId, cost) in edges {
                self.neighborIds[cursor] = cellId;
                self.neighborCosts[cursor] = cost as f32;
                cursor += 1;
            }
        }
    }

    fn transformPoint(&self, x: f64, y: f64) -> Value {
        let [a, b, c, d, e, f] = self.gridToBoundsTransform;
        json!({ "x": a * x + b * y + c, "y": d * x + e * y + f })
    }

    pub fn get_output(&self) -> Value {
        let mut result = Vec::new();
        for connId in 0..self.solvedRoutes.len() {
            let routes = self.getSolvedRoutesForConn(connId);
            if routes.is_empty() {
                continue;
            }
            let connName = &self.connIdToName[connId];
            for route in routes {
                let mut points: Vec<Value> = route
                    .states
                    .iter()
                    .map(|&state| {
                        let z = state / self.planeSize;
                        let cellId = state - z * self.planeSize;
                        let mut tp =
                            self.transformPoint(self.cellCenterX[cellId], self.cellCenterY[cellId]);
                        tp["z"] = json!(self.availableZ.get(z).copied().unwrap_or(z as f64));
                        tp
                    })
                    .collect();
                if !points.is_empty() {
                    points[0] = route.startPoint.clone();
                    if points.len() > 1 {
                        let last = points.len() - 1;
                        points[last] = route.endPoint.clone();
                    }
                }
                let vias: Vec<Value> = route
                    .viaCellIds
                    .iter()
                    .map(|&cellId| {
                        self.transformPoint(self.cellCenterX[cellId], self.cellCenterY[cellId])
                    })
                    .collect();
                let mut output = json!({"connectionName": connName});
                if let Some(regionId) = self.nodeWithPortPoints.get("capacityMeshNodeId") {
                    output["regionId"] = regionId.clone();
                }
                output["traceThickness"] = json!(self.traceThickness);
                output["viaDiameter"] = json!(self.viaDiameter);
                output["route"] = json!(points);
                output["vias"] = json!(vias);
                result.push(output);
            }
        }
        Value::Array(result)
    }

    fn getSolvedRoutesForConn(&self, connId: usize) -> &[SolvedRouteInternal] {
        self.solvedRoutes
            .get(connId)
            .and_then(Option::as_deref)
            .unwrap_or(&[])
    }

    pub fn solved_segment_count(&self) -> usize {
        (0..self.solvedRoutes.len())
            .map(|id| self.getSolvedRoutesForConn(id).len())
            .sum()
    }

    fn computeGridToBoundsTransform(&self) -> [f64; 6] {
        let mut minCenterX = f64::INFINITY;
        let mut maxCenterX = f64::NEG_INFINITY;
        let mut minCenterY = f64::INFINITY;
        let mut maxCenterY = f64::NEG_INFINITY;
        for cellId in 0..self.planeSize {
            minCenterX = minCenterX.min(self.cellCenterX[cellId]);
            maxCenterX = maxCenterX.max(self.cellCenterX[cellId]);
            minCenterY = minCenterY.min(self.cellCenterY[cellId]);
            maxCenterY = maxCenterY.max(self.cellCenterY[cellId]);
        }
        let xSpan = maxCenterX - minCenterX;
        let ySpan = maxCenterY - minCenterY;
        let width = self.boundsMaxX - self.boundsMinX;
        let height = self.boundsMaxY - self.boundsMinY;
        let a = if xSpan > 0.0 { width / xSpan } else { 1.0 };
        let e = if ySpan > 0.0 { height / ySpan } else { 1.0 };
        let c = if xSpan > 0.0 {
            self.boundsMinX - a * minCenterX
        } else {
            (self.boundsMinX + self.boundsMaxX) / 2.0 - minCenterX
        };
        let f = if ySpan > 0.0 {
            self.boundsMinY - e * minCenterY
        } else {
            (self.boundsMinY + self.boundsMaxY) / 2.0 - minCenterY
        };
        [a, 0.0, c, 0.0, e, f]
    }

    pub fn visualize(&self) -> Value {
        let layerColors = ["red", "blue", "orange", "green"];
        let traceColors = [
            "rgba(255,0,0,0.75)",
            "rgba(0,0,255,0.75)",
            "rgba(255,165,0,0.75)",
            "rgba(0,128,0,0.75)",
        ];
        let mut points = Vec::new();
        let mut lines = Vec::new();
        let mut circles = Vec::new();
        let mut rects = vec![json!({
            "center": self.nodeWithPortPoints["center"],
            "width": self.nodeWithPortPoints["width"],
            "height": self.nodeWithPortPoints["height"],
            "stroke": "gray",
        })];
        if self.showPenaltyMap {
            let maxPenalty = self.penalty2d.iter().copied().fold(0.0_f64, f64::max);
            if maxPenalty > 0.0 {
                for cellId in 0..self.planeSize {
                    let penalty = self.penalty2d[cellId];
                    if penalty <= 0.0 {
                        continue;
                    }
                    let alpha = 0.6_f64.min(penalty / maxPenalty * 0.6);
                    rects.push(json!({
                        "center": self.transformPoint(self.cellCenterX[cellId], self.cellCenterY[cellId]),
                        "width": self.cellWidth[cellId] * self.gridToBoundsTransform[0],
                        "height": self.cellHeight[cellId] * self.gridToBoundsTransform[4],
                        "fill": format!("rgba(255,165,0,{alpha:.3})"),
                    }));
                }
            }
        }
        if self.showUsedCellMap {
            for z in 0..self.layers {
                for cellId in 0..self.planeSize {
                    if self.cellOccupants[z * self.planeSize + cellId].primary == -1 {
                        continue;
                    }
                    rects.push(json!({
                        "center": self.transformPoint(self.cellCenterX[cellId], self.cellCenterY[cellId]),
                        "width": self.cellWidth[cellId] * self.gridToBoundsTransform[0],
                        "height": self.cellHeight[cellId] * self.gridToBoundsTransform[4],
                        "fill": "rgba(0,0,255,0.5)",
                    }));
                }
            }
        }
        for pp in self.nodeWithPortPoints["portPoints"]
            .as_array()
            .expect("portPoints is required")
        {
            let z = pp["z"].as_f64().unwrap() as usize;
            points.push(json!({ "x": pp["x"], "y": pp["y"], "color": layerColors.get(z).copied().unwrap_or("gray"), "label": pp["connectionName"] }));
        }
        let transformedRoutes = self.get_output();
        for route in transformedRoutes.as_array().unwrap() {
            let path = route["route"].as_array().unwrap();
            if path.len() < 2 {
                continue;
            }
            let mut segStart = 0;
            for i in 1..path.len() {
                let prev = &path[i - 1];
                let curr = &path[i];
                if curr["z"] != prev["z"] {
                    if i - segStart >= 2 {
                        let ps: Vec<Value> = path[segStart..i]
                            .iter()
                            .map(|p| json!({"x": p["x"], "y": p["y"]}))
                            .collect();
                        let z = prev["z"].as_f64().unwrap() as usize;
                        lines.push(json!({"points": ps, "strokeColor": traceColors.get(z).copied().unwrap_or("rgba(128,128,128,0.75)"), "strokeWidth": self.traceThickness}));
                    }
                    segStart = i;
                }
            }
            if path.len() - segStart >= 2 {
                let z = path[segStart]["z"].as_f64().unwrap() as usize;
                let ps: Vec<Value> = path[segStart..]
                    .iter()
                    .map(|p| json!({"x": p["x"], "y": p["y"]}))
                    .collect();
                lines.push(json!({"points": ps, "strokeColor": traceColors.get(z).copied().unwrap_or("rgba(128,128,128,0.75)"), "strokeWidth": self.traceThickness}));
            }
        }
        for route in transformedRoutes.as_array().unwrap() {
            for via in route["vias"].as_array().unwrap() {
                circles.push(json!({"center": {"x": via["x"], "y": via["y"]}, "radius": self.viaDiameter / 2.0, "fill": "rgba(0,0,0,0.3)", "stroke": "black"}));
            }
        }
        if self.activeConnSeg.is_some() {
            for z in 0..self.layers {
                for cellId in 0..self.planeSize {
                    if self.visitedFlatStamp[z * self.planeSize + cellId] != self.stamp {
                        continue;
                    }
                    let mut tc =
                        self.transformPoint(self.cellCenterX[cellId], self.cellCenterY[cellId]);
                    tc["color"] = json!("rgba(0,0,255,0.2)");
                    points.push(tc);
                }
            }
        }
        json!({"points": points, "lines": lines, "circles": circles, "rects": rects, "coordinateSystem": "cartesian", "title": format!("HighDensityA03 [{} solved, {} remaining]", self.solved_segment_count(), self.unsolvedSegs.len())})
    }
}

#[cfg(test)]
mod occupancy_tests {
    use super::*;

    #[test]
    fn sparse_shared_occupants_preserve_order_promotion_and_removal() {
        let mut solver = HighDensitySolverA03::new(json!({"viaDiameter":0.3}));
        solver.cellOccupants = vec![
            CellOccupants {
                primary: 0,
                shared: None,
            },
            CellOccupants::default(),
        ];
        solver.connIdToRootNetId = vec![0, 1, 2, 3, 4];
        solver.addSharedOccupant(0, 1);
        solver.addSharedOccupant(0, 2);
        solver.addSharedOccupant(0, 1);
        solver.addSharedOccupant(0, 0);
        assert_eq!(solver.fillTraceOccupants(0, 4), vec![0, 1, 2]);
        assert_eq!(solver.fillTraceOccupants(0, 1), vec![0, 2]);
        solver.removeOccupant(0, 0);
        assert_eq!(solver.cellOccupants[0].primary, 2);
        assert_eq!(solver.fillTraceOccupants(0, 4), vec![2, 1]);
        solver.removeOccupant(0, 1);
        assert!(solver.cellOccupants[0].shared.is_none());
        solver.removeOccupant(0, 2);
        assert_eq!(solver.cellOccupants[0].primary, -1);
        solver.addSharedOccupant(1, 3);
        solver.replaceOccupants(1, 4);
        assert!(solver.cellOccupants[1].shared.is_none());
        assert_eq!(solver.cellOccupants[1].primary, 4);
        assert_eq!(
            std::mem::size_of::<Option<Box<Vec<usize>>>>(),
            std::mem::size_of::<usize>()
        );
        assert_eq!(
            std::mem::size_of::<Option<Vec<usize>>>(),
            3 * std::mem::size_of::<usize>()
        );
        solver.cellOccupants = vec![
            CellOccupants {
                primary: 0,
                shared: Some(Box::new(vec![1, 2, 1])),
            },
            CellOccupants {
                primary: 1,
                shared: Some(Box::new(vec![3, 2])),
            },
            CellOccupants {
                primary: 2,
                shared: None,
            },
        ];
        solver.connIdToRootNetId = vec![0, 1, 2, 4, 4];
        let mut membership = OccupantMembership::default();
        for overflow in [false, true] {
            if overflow {
                membership.generation = u32::MAX;
            }
            membership.begin(5);
            let mut expected = Vec::new();
            let mut actual = Vec::new();
            for cell in [0, 1, 0, 2, 1] {
                solver.pushFlatOccupants(cell, 4, &mut expected);
                solver.pushFlatOccupantsWithMembership(
                    cell,
                    4,
                    solver.connIdToRootNetId[4],
                    &mut actual,
                    &mut membership,
                );
            }
            assert_eq!(actual, expected);
            assert_eq!(actual, vec![0, 1, 2]);
            if overflow {
                assert_eq!(membership.generation, 1);
            }
        }
    }
}
