type InitialPenaltyFn = Box<dyn Fn(&Value) -> f64>;

use serde_json::{Value, json};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::get_connection_port_point_pairs::get_connection_port_point_pairs;
use crate::grid_to_affine_transform::{
    AffineTransform, GridToAffineTransformParams, apply_affine_transform_to_point,
    compute_grid_to_affine_transform,
};
use crate::max_iterations_by_node_size_and_connection_count::{
    MaxIterationsByNodeSizeAndConnectionCountInput,
    compute_max_iterations_by_node_size_and_connection_count,
};

type ConnId = i32;

#[derive(Clone, Copy)]
struct ActiveConnection {
    id: ConnId,
    root_id: Option<usize>,
    allows_root_overlap: bool,
}

#[derive(Clone)]
struct RippedNode {
    id: ConnId,
    prev: Option<usize>,
}

fn ripped_contains(nodes: &[RippedNode], r: Option<usize>, id: ConnId) -> bool {
    let mut cur = r;
    while let Some(index) = cur {
        let node = &nodes[index];
        if node.id == id {
            return true;
        }
        cur = node.prev;
    }
    false
}

#[derive(Clone, Copy)]
struct Cell {
    z: i32,
    row: i32,
    col: i32,
}

#[derive(Clone, Copy)]
struct SearchNode {
    z: i32,
    row: i32,
    col: i32,
    g: f64,
    parent_idx: isize,
    ripped: Option<usize>,
}

#[derive(Clone)]
struct ConnectionSeg {
    conn_id: ConnId,
    start_z: i32,
    start_row: i32,
    start_col: i32,
    start_point: Value,
    end_z: i32,
    end_row: i32,
    end_col: i32,
    end_point: Value,
}

#[derive(Clone)]
struct SolvedRouteInternal {
    start_z: i32,
    start_row: i32,
    start_col: i32,
    start_point: Value,
    end_z: i32,
    end_row: i32,
    end_col: i32,
    end_point: Value,
    cells: Vec<Cell>,
    via_cells: Vec<(i32, i32)>,
}

#[derive(Clone, Copy, Default)]
struct HeapEntry {
    f: f64,
    seq: usize,
    id: usize,
}

#[derive(Default)]
struct MinHeap {
    entries: Vec<HeapEntry>,
    n: usize,
}

impl MinHeap {
    fn push(&mut self, f: f64, seq: usize, id: usize) {
        let mut i = self.n;
        self.n += 1;
        if i == self.entries.len() {
            self.entries.push(HeapEntry { f, seq, id });
        } else {
            self.entries[i] = HeapEntry { f, seq, id };
        }
        let entries = &mut self.entries[..self.n];
        let held = entries[i];
        while i > 0 {
            let p = (i - 1) >> 1;
            let parent = entries[p];
            if Self::less(parent, held) {
                break;
            }
            entries[i] = parent;
            i = p;
        }
        entries[i] = held;
    }

    fn pop(&mut self) -> usize {
        let out = self.entries[0].id;
        self.n -= 1;
        if self.n > 0 {
            self.entries[0] = self.entries[self.n];
            self.sift_down(0);
        }
        out
    }

    fn clear(&mut self) {
        self.n = 0;
    }

    fn sift_down(&mut self, mut i: usize) {
        let entries = &mut self.entries[..self.n];
        let n = entries.len();
        let held = entries[i];
        loop {
            let l = i * 2 + 1;
            let r = l + 1;
            if l >= n {
                break;
            }
            let mut m = l;
            if r < n && !Self::less(entries[l], entries[r]) {
                m = r;
            }
            if Self::less(held, entries[m]) {
                break;
            }
            entries[i] = entries[m];
            i = m;
        }
        entries[i] = held;
    }

    #[inline(always)]
    fn less(first: HeapEntry, second: HeapEntry) -> bool {
        let fi = first.f;
        let fj = second.f;
        if fi != fj {
            return fi < fj;
        }
        first.seq < second.seq
    }
}

struct HyperParameters {
    shuffle_seed: f64,
    rip_cost: f64,
    rip_trace_penalty: f64,
    rip_via_penalty: f64,
    via_base_cost: f64,
    greedy_multiplier: f64,
}

fn to_root_net_name(connection_name: &str, root_connection_name: Option<&str>) -> String {
    if let Some(root) = root_connection_name {
        return root.to_owned();
    }
    if let Some((root, suffix)) = connection_name.rsplit_once("_mst")
        && !suffix.is_empty()
        && suffix.bytes().all(|c| c.is_ascii_digit())
    {
        return root.to_owned();
    }
    connection_name.to_owned()
}

fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    if (-0.5..0.0).contains(&value) {
        return -0.0;
    }
    let floor = value.floor();
    if value - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    }
}

const DIRS_DR: [i32; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIRS_DC: [i32; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];

pub struct HighDensitySolverA01 {
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub max_iterations: usize,
    pub progress: f64,
    pub stats: Value,
    node_with_port_points: Value,
    cell_size_mm: f64,
    via_diameter: f64,
    max_rips: usize,
    max_cell_count: Option<f64>,
    trace_thickness: f64,
    trace_margin: f64,
    via_min_dist_from_border: f64,
    show_penalty_map: bool,
    show_used_cell_map: bool,
    effort: f64,
    step_multiplier: usize,
    hyper_parameters: HyperParameters,
    initial_penalty_map: Option<Vec<f64>>,
    pub initial_penalty_fn: Option<InitialPenaltyFn>,
    rows: i32,
    cols: i32,
    layers: i32,
    grid_origin: (f64, f64),
    grid_to_bounds_transform: Option<AffineTransform>,
    available_z: Vec<f64>,
    conn_name_to_id: HashMap<String, ConnId>,
    conn_id_to_name: Vec<String>,
    conn_id_to_root_net: Vec<String>,
    conn_id_to_root_id: Vec<usize>,
    conn_allows_root_overlap: Vec<bool>,
    overlap_friendly_root_nets: HashSet<String>,
    plane_size: usize,
    used_cells_flat: Vec<i32>,
    port_owner_flat: Vec<i32>,
    used_diag_flat: Vec<i32>,
    penalty_2d: Vec<f64>,
    visited_stamp: Vec<u32>,
    shared_cross_root_port_cells: HashSet<usize>,
    stamp: u32,
    via_offsets_dr: Vec<i32>,
    via_offsets_dc: Vec<i32>,
    via_offsets_len: usize,
    min_via_row: i32,
    max_via_row: i32,
    min_via_col: i32,
    max_via_col: i32,
    used_indices_by_conn: Vec<Vec<usize>>,
    used_diag_indices_by_conn: Vec<Vec<usize>>,
    unsolved_segs: VecDeque<ConnectionSeg>,
    solved_routes: Vec<(ConnId, Vec<SolvedRouteInternal>)>,
    active_conn_seg: Option<ConnectionSeg>,
    active_conn_id: ConnId,
    cross_layer_search: bool,
    node_pool: Vec<SearchNode>,
    heap: MinHeap,
    seq_counter: usize,
    via_occs: Vec<ConnId>,
    via_occupants_by_cell: HashMap<usize, Box<[ConnId]>>,
    rip_count: Vec<usize>,
    total_rip_events: usize,
    search_iterations: usize,
    consecutive_skips: usize,
    penalty_cap: f64,
    base_search_budget_iters: f64,
    move_cost: f64,
    move_ripped: Option<usize>,
    ripped_nodes: Vec<RippedNode>,
}

impl HighDensitySolverA01 {
    pub fn new(props: Value) -> Self {
        let hp = &props["hyperParameters"];
        Self {
            solved: false,
            failed: false,
            error: None,
            iterations: 0,
            max_iterations: props["maxIterations"].as_u64().unwrap_or(100_000_000) as usize,
            progress: 0.0,
            stats: json!({}),
            node_with_port_points: props["nodeWithPortPoints"].clone(),
            cell_size_mm: props["cellSizeMm"]
                .as_f64()
                .expect("cellSizeMm is required"),
            via_diameter: props["viaDiameter"]
                .as_f64()
                .expect("viaDiameter is required"),
            max_rips: 200,
            max_cell_count: props["maxCellCount"].as_f64(),
            trace_thickness: props["traceThickness"].as_f64().unwrap_or(0.1),
            trace_margin: props["traceMargin"].as_f64().unwrap_or(0.15),
            via_min_dist_from_border: props["viaMinDistFromBorder"].as_f64().unwrap_or(0.15),
            show_penalty_map: props["showPenaltyMap"].as_bool().unwrap_or(false),
            show_used_cell_map: props["showUsedCellMap"].as_bool().unwrap_or(false),
            effort: props["effort"].as_f64().unwrap_or(1.0),
            step_multiplier: props["stepMultiplier"]
                .as_f64()
                .unwrap_or(1.0)
                .floor()
                .max(1.0) as usize,
            hyper_parameters: HyperParameters {
                shuffle_seed: hp["shuffleSeed"].as_f64().unwrap_or(0.0),
                rip_cost: hp["ripCost"].as_f64().unwrap_or(10.0),
                rip_trace_penalty: hp["ripTracePenalty"].as_f64().unwrap_or(0.5),
                rip_via_penalty: hp["ripViaPenalty"].as_f64().unwrap_or(0.75),
                via_base_cost: hp["viaBaseCost"].as_f64().unwrap_or(0.1),
                greedy_multiplier: hp["greedyMultiplier"].as_f64().unwrap_or(1.5),
            },
            initial_penalty_fn: None,
            initial_penalty_map: props["penaltyMap"].as_array().map(|values| {
                values
                    .iter()
                    .map(|v| v.as_f64().expect("penaltyMap must contain numbers"))
                    .collect()
            }),
            rows: 0,
            cols: 0,
            layers: 0,
            grid_origin: (0.0, 0.0),
            grid_to_bounds_transform: None,
            available_z: Vec::new(),
            conn_name_to_id: HashMap::new(),
            conn_id_to_name: Vec::new(),
            conn_id_to_root_net: Vec::new(),
            conn_id_to_root_id: Vec::new(),
            conn_allows_root_overlap: Vec::new(),
            overlap_friendly_root_nets: HashSet::new(),
            plane_size: 0,
            used_cells_flat: Vec::new(),
            port_owner_flat: Vec::new(),
            used_diag_flat: Vec::new(),
            penalty_2d: Vec::new(),
            visited_stamp: Vec::new(),
            shared_cross_root_port_cells: HashSet::new(),
            stamp: 0,
            via_offsets_dr: Vec::new(),
            via_offsets_dc: Vec::new(),
            via_offsets_len: 0,
            min_via_row: 0,
            max_via_row: 0,
            min_via_col: 0,
            max_via_col: 0,
            used_indices_by_conn: Vec::new(),
            used_diag_indices_by_conn: Vec::new(),
            unsolved_segs: VecDeque::new(),
            solved_routes: Vec::new(),
            active_conn_seg: None,
            active_conn_id: -1,
            cross_layer_search: false,
            node_pool: Vec::new(),
            heap: MinHeap::default(),
            seq_counter: 0,
            via_occs: Vec::new(),
            via_occupants_by_cell: HashMap::new(),
            rip_count: Vec::new(),
            total_rip_events: 0,
            search_iterations: 0,
            consecutive_skips: 0,
            penalty_cap: 0.0,
            base_search_budget_iters: 0.0,
            move_cost: 0.0,
            move_ripped: None,
            ripped_nodes: Vec::new(),
        }
    }

    pub fn setup(&mut self) {
        self.via_occupants_by_cell.clear();
        let width = self.node_with_port_points["width"]
            .as_f64()
            .expect("width is required");
        let height = self.node_with_port_points["height"]
            .as_f64()
            .expect("height is required");
        let center_x = self.node_with_port_points["center"]["x"]
            .as_f64()
            .expect("center.x is required");
        let center_y = self.node_with_port_points["center"]["y"]
            .as_f64()
            .expect("center.y is required");
        let port_points = self.node_with_port_points["portPoints"]
            .as_array()
            .expect("portPoints is required")
            .clone();
        self.available_z = if let Some(zs) = self.node_with_port_points["availableZ"].as_array() {
            zs.iter()
                .map(|z| z.as_f64().expect("availableZ must contain numbers"))
                .collect()
        } else {
            let mut zs = Vec::new();
            for pp in &port_points {
                let z = pp["z"].as_f64().expect("port point z is required");
                if !zs.contains(&z) {
                    zs.push(z);
                }
            }
            zs.sort_by(|a, b| a.partial_cmp(b).expect("z must be finite"));
            zs
        };
        self.rows = (height / self.cell_size_mm).floor() as i32;
        self.cols = (width / self.cell_size_mm).floor() as i32;
        self.layers = self.available_z.len() as i32;
        self.plane_size = (self.rows * self.cols) as usize;
        let total_cells = self.layers as usize * self.plane_size;
        if let Some(max_cell_count) = self.max_cell_count
            && total_cells as f64 > max_cell_count
        {
            self.error = Some(format!(
                "Cell count {} exceeds maxCellCount {}",
                total_cells, max_cell_count
            ));
            self.failed = true;
            return;
        }
        let total_diags =
            (self.layers * (self.rows - 1).max(0) * (self.cols - 1).max(0) * 2) as usize;
        self.grid_origin = (center_x - width / 2.0, center_y - height / 2.0);
        self.grid_to_bounds_transform = Some(compute_grid_to_affine_transform(
            GridToAffineTransformParams {
                origin_x: self.grid_origin.0,
                origin_y: self.grid_origin.1,
                rows: self.rows as f64,
                cols: self.cols as f64,
                cell_size_mm: self.cell_size_mm,
                width,
                height,
            },
        ));
        self.conn_name_to_id.clear();
        self.conn_id_to_name.clear();
        self.conn_id_to_root_net.clear();
        self.conn_id_to_root_id.clear();
        self.conn_allows_root_overlap.clear();
        self.overlap_friendly_root_nets.clear();
        self.penalty_2d = vec![0.0; self.plane_size];
        if let Some(penalties) = &self.initial_penalty_map {
            assert_eq!(
                penalties.len(),
                self.plane_size,
                "penaltyMap size must match grid"
            );
            self.penalty_2d.clone_from(penalties);
        }
        if let Some(initial_penalty_fn) = &self.initial_penalty_fn {
            for row in 0..self.rows {
                let row_base = row * self.cols;
                for col in 0..self.cols {
                    let x = self.grid_origin.0 + (col as f64 + 0.5) * self.cell_size_mm;
                    let y = self.grid_origin.1 + (row as f64 + 0.5) * self.cell_size_mm;
                    let px = (col as f64 + 0.5) / self.cols as f64;
                    let py = (row as f64 + 0.5) / self.rows as f64;
                    self.penalty_2d[(row_base + col) as usize] = initial_penalty_fn(
                        &json!({ "x": x, "y": y, "px": px, "py": py, "row": row, "col": col }),
                    );
                }
            }
        }
        self.used_cells_flat = vec![-1; total_cells];
        self.port_owner_flat = vec![-1; total_cells];
        self.used_diag_flat = vec![-1; total_diags];
        self.visited_stamp = vec![0; total_cells];
        self.stamp = 0;

        let via_radius_cells = (self.via_diameter / 2.0 / self.cell_size_mm).ceil() as i32;
        let r2 = via_radius_cells * via_radius_cells;
        let mut dr_list = Vec::new();
        let mut dc_list = Vec::new();
        for dr in -via_radius_cells..=via_radius_cells {
            for dc in -via_radius_cells..=via_radius_cells {
                if dr * dr + dc * dc <= r2 {
                    dr_list.push(dr);
                    dc_list.push(dc);
                }
            }
        }
        self.via_offsets_len = dr_list.len();
        self.via_offsets_dr = dr_list;
        self.via_offsets_dc = dc_list;
        if self.via_min_dist_from_border > 0.0 {
            let border_cells = (self.via_min_dist_from_border / self.cell_size_mm).ceil() as i32;
            self.min_via_row = border_cells;
            self.max_via_row = self.rows - 1 - border_cells;
            self.min_via_col = border_cells;
            self.max_via_col = self.cols - 1 - border_cells;
        } else {
            self.min_via_row = 0;
            self.max_via_row = self.rows - 1;
            self.min_via_col = 0;
            self.max_via_col = self.cols - 1;
        }
        self.unsolved_segs = self.build_connection_segs().into();
        // Root names and duplicate-segment eligibility are fixed after setup.
        // Retain names for output; search only needs equality and membership.
        let mut root_id_by_name = HashMap::new();
        self.conn_id_to_root_id = self
            .conn_id_to_root_net
            .iter()
            .map(|root| {
                let next_id = root_id_by_name.len();
                *root_id_by_name.entry(root.as_str()).or_insert(next_id)
            })
            .collect();
        self.conn_allows_root_overlap = self
            .conn_id_to_root_net
            .iter()
            .map(|root| self.overlap_friendly_root_nets.contains(root))
            .collect();
        self.shared_cross_root_port_cells.clear();
        let mut root_by_port_flat: HashMap<usize, usize> = HashMap::new();
        for pp in &port_points {
            let name = pp["connectionName"]
                .as_str()
                .expect("connectionName is required");
            let Some(&conn_id) = self.conn_name_to_id.get(name) else {
                continue;
            };
            let cell = self.point_to_cell(pp);
            let flat_idx = ((cell.z * self.rows + cell.row) * self.cols + cell.col) as usize;
            let root_net = &self.conn_id_to_root_id[conn_id as usize];
            if let Some(existing_root) = root_by_port_flat.get(&flat_idx) {
                if existing_root != root_net {
                    self.shared_cross_root_port_cells.insert(flat_idx);
                }
            } else {
                root_by_port_flat.insert(flat_idx, *root_net);
            }
            if let Some(existing) = self.port_owner_flat.get_mut(flat_idx) {
                *existing = if *existing == -1 || *existing == conn_id {
                    conn_id
                } else {
                    -2
                };
            }
        }
        self.solved_routes.clear();
        self.used_indices_by_conn.clear();
        self.used_diag_indices_by_conn.clear();
        self.rip_count.clear();
        self.consecutive_skips = 0;
        self.penalty_cap = self.hyper_parameters.rip_cost * 0.5;
        self.shuffle_connections();
        let budget = compute_max_iterations_by_node_size_and_connection_count(
            MaxIterationsByNodeSizeAndConnectionCountInput {
                plane_size: self.plane_size as f64,
                layers: self.layers as f64,
                connection_count: self.unsolved_segs.len() as f64,
                effort: self.effort,
                max_iterations: self.max_iterations as f64,
            },
        );
        self.base_search_budget_iters = budget.base_search_budget_iters;
        self.max_iterations = budget.max_iterations_iters as usize;
        self.active_conn_seg = None;
        self.active_conn_id = -1;
        self.node_pool.clear();
        self.ripped_nodes.clear();
        self.move_ripped = None;
        self.heap = MinHeap::default();
        self.seq_counter = 0;
    }

    pub fn step(&mut self) {
        for _ in 0..self.step_multiplier {
            if self.solved || self.failed {
                return;
            }
            self.step_once();
        }
    }

    fn step_once(&mut self) {
        if self.active_conn_seg.is_none() {
            if self.unsolved_segs.is_empty() {
                self.solved = true;
                return;
            }
            let next = self.unsolved_segs.pop_front().unwrap();
            self.active_conn_seg = Some(next.clone());
            self.active_conn_id = next.conn_id;
            self.cross_layer_search = next.start_z != next.end_z;
            self.node_pool.clear();
            self.ripped_nodes.clear();
            self.move_ripped = None;
            self.heap.clear();
            self.seq_counter = 0;
            self.search_iterations = 0;
            // Occupancy and the active connection stay fixed until this search ends.
            self.via_occupants_by_cell.clear();
            self.next_stamp();
            let h = self.compute_h(
                next.start_z,
                next.start_row,
                next.start_col,
                next.end_z,
                next.end_row,
                next.end_col,
            );
            let f = h * self.hyper_parameters.greedy_multiplier;
            self.node_pool.push(SearchNode {
                z: next.start_z,
                row: next.start_row,
                col: next.start_col,
                g: 0.0,
                parent_idx: -1,
                ripped: None,
            });
            self.heap.push(f, self.seq_counter, 0);
            self.seq_counter += 1;
            return;
        }
        self.search_iterations += 1;
        let conn_rips = self
            .rip_count
            .get(self.active_conn_id as usize)
            .copied()
            .unwrap_or(0);
        let budget =
            js_round(self.base_search_budget_iters * (1.0 + conn_rips.min(10) as f64 * 0.25));
        if self.search_iterations as f64 > budget {
            for pen in &mut self.penalty_2d {
                *pen *= 0.9;
            }
            self.unsolved_segs
                .push_back(self.active_conn_seg.take().unwrap());
            self.active_conn_id = -1;
            self.heap.clear();
            self.node_pool.clear();
            self.ripped_nodes.clear();
            self.move_ripped = None;
            self.consecutive_skips += 1;
            if self.consecutive_skips >= self.unsolved_segs.len() * 3 {
                self.error = Some(format!(
                    "Convergence failure: {} connections stuck",
                    self.unsolved_segs.len()
                ));
                self.failed = true;
            }
            return;
        }
        if self.heap.n == 0 {
            self.error = Some(format!(
                "No path found for {}",
                self.conn_id_to_name[self.active_conn_id as usize]
            ));
            self.failed = true;
            return;
        }
        let node_idx = self.heap.pop();
        let node = self.node_pool[node_idx];
        let SearchNode {
            z,
            row,
            col,
            g,
            ripped,
            ..
        } = node;
        let cell_idx = ((z * self.rows + row) * self.cols + col) as usize;
        if self.visited_stamp.get(cell_idx).copied() == Some(self.stamp) {
            return;
        }
        if let Some(stamp) = self.visited_stamp.get_mut(cell_idx) {
            *stamp = self.stamp;
        }
        let seg = self.active_conn_seg.as_ref().unwrap();
        if z == seg.end_z && row == seg.end_row && col == seg.end_col {
            self.finalize_route(node_idx);
            self.active_conn_seg = None;
            self.active_conn_id = -1;
            return;
        }
        let (end_z, end_row, end_col) = (seg.end_z, seg.end_row, seg.end_col);
        let active_conn = ActiveConnection {
            id: self.active_conn_id,
            root_id: self
                .conn_id_to_root_id
                .get(self.active_conn_id as usize)
                .copied(),
            allows_root_overlap: self.conn_allows_root_overlap[self.active_conn_id as usize],
        };
        for d in 0..8 {
            let nr = row + DIRS_DR[d];
            let nc = col + DIRS_DC[d];
            if nr < 0 || nr >= self.rows || nc < 0 || nc >= self.cols {
                continue;
            }
            let n_idx = ((z * self.rows + nr) * self.cols + nc) as usize;
            if self.visited_stamp[n_idx] == self.stamp {
                continue;
            }
            self.compute_move_cost_and_rips(active_conn, z, row, col, z, nr, nc, ripped);
            if self.move_cost < 0.0 {
                continue;
            }
            let g2 = g + self.move_cost;
            let f2 = g2
                + self.compute_h(z, nr, nc, end_z, end_row, end_col)
                    * self.hyper_parameters.greedy_multiplier;
            let new_node_idx = self.node_pool.len();
            self.node_pool.push(SearchNode {
                z,
                row: nr,
                col: nc,
                g: g2,
                parent_idx: node_idx as isize,
                ripped: self.move_ripped,
            });
            self.heap.push(f2, self.seq_counter, new_node_idx);
            self.seq_counter += 1;
        }
        let can_via = row >= self.min_via_row
            && row <= self.max_via_row
            && col >= self.min_via_col
            && col <= self.max_via_col;
        if can_via {
            for nz in 0..self.layers {
                if nz == z {
                    continue;
                }
                let n_idx = ((nz * self.rows + row) * self.cols + col) as usize;
                if self.visited_stamp[n_idx] == self.stamp {
                    continue;
                }
                self.compute_move_cost_and_rips(active_conn, z, row, col, nz, row, col, ripped);
                if self.move_cost < 0.0 {
                    continue;
                }
                let g2 = g + self.move_cost;
                let f2 = g2
                    + self.compute_h(nz, row, col, end_z, end_row, end_col)
                        * self.hyper_parameters.greedy_multiplier;
                let new_node_idx = self.node_pool.len();
                self.node_pool.push(SearchNode {
                    z: nz,
                    row,
                    col,
                    g: g2,
                    parent_idx: node_idx as isize,
                    ripped: self.move_ripped,
                });
                self.heap.push(f2, self.seq_counter, new_node_idx);
                self.seq_counter += 1;
            }
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "Keep the argument list aligned with the TypeScript source."
    )]
    fn compute_move_cost_and_rips(
        &mut self,
        active_conn: ActiveConnection,
        from_z: i32,
        from_row: i32,
        from_col: i32,
        to_z: i32,
        to_row: i32,
        to_col: i32,
        ripped: Option<usize>,
    ) {
        let mut cost = 0.0;
        let ripped_start = self.ripped_nodes.len();
        let mut r = ripped;
        let cols = self.cols;
        if from_z != to_z {
            cost += self.hyper_parameters.via_base_cost;
            cost += self.penalty_2d[(to_row * cols + to_col) as usize].min(self.penalty_cap);
            let to_flat_idx = ((to_z * self.rows + to_row) * cols + to_col) as usize;
            let fixed_owner = self.port_owner_flat[to_flat_idx];
            let fixed_same_root =
                self.conn_id_to_root_id.get(fixed_owner as usize).copied() == active_conn.root_id;
            let allow_fixed_overlap = fixed_same_root && active_conn.allows_root_overlap;
            let is_seg_end = self.active_conn_seg.as_ref().is_some_and(|seg| {
                to_z == seg.end_z && to_row == seg.end_row && to_col == seg.end_col
            });
            if fixed_owner >= 0
                && fixed_owner != active_conn.id
                && !allow_fixed_overlap
                && !is_seg_end
            {
                self.move_cost = -1.0;
                self.move_ripped = r;
                return;
            }
            let cell_idx = (to_row * cols + to_col) as usize;
            if !self.via_occupants_by_cell.contains_key(&cell_idx) {
                self.fill_via_occupants(to_row, to_col, active_conn);
                self.via_occupants_by_cell
                    .insert(cell_idx, self.via_occs.clone().into_boxed_slice());
            }
            for &occ in &self.via_occupants_by_cell[&cell_idx] {
                if !ripped_contains(&self.ripped_nodes, r, occ) {
                    cost += self.hyper_parameters.rip_cost;
                    self.ripped_nodes.push(RippedNode { id: occ, prev: r });
                    r = Some(self.ripped_nodes.len() - 1);
                }
                cost += self.hyper_parameters.rip_via_penalty;
            }
        } else {
            let dr = (from_row - to_row).abs();
            let dc = (from_col - to_col).abs();
            cost += (if dr + dc > 1 {
                std::f64::consts::SQRT_2
            } else {
                1.0
            }) * self.cell_size_mm;
            cost += self.penalty_2d[(to_row * cols + to_col) as usize].min(self.penalty_cap);
            let flat_idx = ((to_z * self.rows + to_row) * cols + to_col) as usize;
            let fixed_owner = self.port_owner_flat[flat_idx];
            let fixed_same_root =
                self.conn_id_to_root_id.get(fixed_owner as usize).copied() == active_conn.root_id;
            let allow_fixed_overlap = fixed_same_root && active_conn.allows_root_overlap;
            let is_seg_end = self.active_conn_seg.as_ref().is_some_and(|seg| {
                to_z == seg.end_z && to_row == seg.end_row && to_col == seg.end_col
            });
            if fixed_owner >= 0
                && fixed_owner != active_conn.id
                && !allow_fixed_overlap
                && !is_seg_end
            {
                self.move_cost = -1.0;
                self.move_ripped = r;
                return;
            }
            let occ = self.used_cells_flat[flat_idx];
            let same_root =
                self.conn_id_to_root_id.get(occ as usize).copied() == active_conn.root_id;
            let allow_same_root_overlap = same_root && active_conn.allows_root_overlap;
            if occ != -1 && occ != active_conn.id && !allow_same_root_overlap {
                if !ripped_contains(&self.ripped_nodes, r, occ) {
                    cost += self.hyper_parameters.rip_cost;
                    self.ripped_nodes.push(RippedNode { id: occ, prev: r });
                    r = Some(self.ripped_nodes.len() - 1);
                }
                cost += self.hyper_parameters.rip_trace_penalty;
            }
            if dr == 1 && dc == 1 {
                let sq_row = from_row.min(to_row);
                let sq_col = from_col.min(to_col);
                let is_backslash = (from_row < to_row && from_col < to_col)
                    || (from_row > to_row && from_col > to_col);
                let diag_slot = if is_backslash { 0 } else { 1 };
                let crossing_slot = diag_slot ^ 1;
                let sq_cols = self.cols - 1;
                let diag_base = ((to_z * (self.rows - 1) + sq_row) * sq_cols + sq_col) * 2;
                let crossing_occ = self.used_diag_flat[(diag_base + crossing_slot) as usize];
                let crossing_same_root =
                    self.conn_id_to_root_id.get(crossing_occ as usize).copied()
                        == active_conn.root_id;
                let allow_crossing_overlap = crossing_same_root && active_conn.allows_root_overlap;
                if crossing_occ != -1 && crossing_occ != active_conn.id && !allow_crossing_overlap {
                    self.move_cost = -1.0;
                    // No queued candidate can reference nodes created by this rejected move.
                    self.ripped_nodes.truncate(ripped_start);
                    self.move_ripped = ripped;
                    return;
                }
            }
        }
        self.move_cost = cost;
        if cost < 0.0 {
            self.ripped_nodes.truncate(ripped_start);
            self.move_ripped = ripped;
        } else {
            self.move_ripped = r;
        }
    }

    fn fill_via_occupants(&mut self, row: i32, col: i32, active_conn: ActiveConnection) {
        self.via_occs.clear();
        for z in 0..self.layers {
            let z_base = z as usize * self.plane_size;
            for i in 0..self.via_offsets_len {
                let r = row + self.via_offsets_dr[i];
                let c = col + self.via_offsets_dc[i];
                if r < 0 || c < 0 || r >= self.rows || c >= self.cols {
                    continue;
                }
                let occ = self.used_cells_flat[z_base + (r * self.cols + c) as usize];
                if occ == -1 || occ == active_conn.id {
                    continue;
                }
                let same_root =
                    self.conn_id_to_root_id.get(occ as usize).copied() == active_conn.root_id;
                if same_root && active_conn.allows_root_overlap {
                    continue;
                }
                let mut seen = false;
                for &existing in &self.via_occs {
                    if existing == occ {
                        seen = true;
                        break;
                    }
                }
                if !seen {
                    self.via_occs.push(occ);
                }
            }
        }
    }

    fn should_skip_fixed_port_halo(&self, flat_idx: usize, conn_id: ConnId) -> bool {
        let fixed_owner = self.port_owner_flat[flat_idx];
        if fixed_owner == conn_id {
            return false;
        }
        if fixed_owner == -2 {
            return true;
        }
        if fixed_owner < 0 {
            return false;
        }
        let same_root = self.conn_id_to_root_id[fixed_owner as usize]
            == self.conn_id_to_root_id[conn_id as usize];
        !(same_root && self.conn_allows_root_overlap[conn_id as usize])
    }

    fn next_stamp(&mut self) {
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.visited_stamp.fill(0);
            self.stamp = 1;
        }
    }

    fn compute_h(&self, z: i32, row: i32, col: i32, to_z: i32, to_row: i32, to_col: i32) -> f64 {
        let dr = (row - to_row).abs();
        let dc = (col - to_col).abs();
        let manhattan = dr + dc;
        if z == to_z {
            return manhattan as f64 * self.cell_size_mm;
        }
        if !self.cross_layer_search {
            return manhattan as f64 * self.cell_size_mm + self.hyper_parameters.via_base_cost;
        }
        let vr1 = self.min_via_row.max(self.max_via_row.min(row));
        let vc1 = self.min_via_col.max(self.max_via_col.min(col));
        let vr2 = self.min_via_row.max(self.max_via_row.min(to_row));
        let vc2 = self.min_via_col.max(self.max_via_col.min(to_col));
        let via1 =
            (row - vr1).abs() + (col - vc1).abs() + (vr1 - to_row).abs() + (vc1 - to_col).abs();
        let via2 =
            (row - vr2).abs() + (col - vc2).abs() + (vr2 - to_row).abs() + (vc2 - to_col).abs();
        via1.min(via2).max(manhattan) as f64 * self.cell_size_mm
            + self.hyper_parameters.via_base_cost
    }

    fn intern_conn(&mut self, name: &str, root_net_name: Option<&str>) -> ConnId {
        if let Some(&existing) = self.conn_name_to_id.get(name) {
            return existing;
        }
        let id = self.conn_id_to_name.len() as ConnId;
        self.conn_id_to_name.push(name.to_owned());
        self.conn_id_to_root_net
            .push(to_root_net_name(name, root_net_name));
        self.conn_name_to_id.insert(name.to_owned(), id);
        id
    }

    fn build_connection_segs(&mut self) -> Vec<ConnectionSeg> {
        let mut by_name: Vec<(String, Vec<Value>, Option<String>)> = Vec::new();
        for pp in self.node_with_port_points["portPoints"]
            .as_array()
            .expect("portPoints is required")
        {
            let name = pp["connectionName"]
                .as_str()
                .expect("connectionName is required");
            if let Some((_, points, _)) = by_name.iter_mut().find(|(n, _, _)| n == name) {
                points.push(pp.clone());
            } else {
                by_name.push((
                    name.to_owned(),
                    vec![pp.clone()],
                    pp["rootConnectionName"].as_str().map(str::to_owned),
                ));
            }
        }
        let mut segs = Vec::new();
        let mut seen_segment_keys = HashSet::new();
        for (name, pts, root_connection_name) in by_name {
            let point_pairs = get_connection_port_point_pairs(&pts);
            if point_pairs.is_empty() {
                continue;
            }
            let conn_id = self.intern_conn(&name, root_connection_name.as_deref());
            for [start_point, end_point] in point_pairs {
                let s = self.point_to_cell(start_point);
                let e = self.point_to_cell(end_point);
                let endpoint_a = format!("{}:{}:{}", s.z, s.row, s.col);
                let endpoint_b = format!("{}:{}:{}", e.z, e.row, e.col);
                let ordered_endpoints = if endpoint_a < endpoint_b {
                    format!("{}|{}", endpoint_a, endpoint_b)
                } else {
                    format!("{}|{}", endpoint_b, endpoint_a)
                };
                let net_name = root_connection_name.as_deref().unwrap_or(&name);
                let seg_key = format!("{}|{}", net_name, ordered_endpoints);
                if seen_segment_keys.contains(&seg_key) {
                    self.overlap_friendly_root_nets.insert(net_name.to_owned());
                    continue;
                }
                seen_segment_keys.insert(seg_key);
                segs.push(ConnectionSeg {
                    conn_id,
                    start_z: s.z,
                    start_row: s.row,
                    start_col: s.col,
                    start_point: start_point.clone(),
                    end_z: e.z,
                    end_row: e.row,
                    end_col: e.col,
                    end_point: end_point.clone(),
                });
            }
        }
        segs
    }

    fn point_to_cell(&self, pt: &Value) -> Cell {
        let x = pt["x"].as_f64().expect("point x is required");
        let y = pt["y"].as_f64().expect("point y is required");
        let actual_z = pt["z"].as_f64().expect("point z is required");
        let col = 0.0_f64.max(
            ((self.cols - 1) as f64)
                .min(js_round((x - self.grid_origin.0) / self.cell_size_mm - 0.5)),
        ) as i32;
        let row = 0.0_f64.max(
            ((self.rows - 1) as f64)
                .min(js_round((y - self.grid_origin.1) / self.cell_size_mm - 0.5)),
        ) as i32;
        let z = self
            .available_z
            .iter()
            .rposition(|&z| z == actual_z)
            .unwrap_or(0) as i32;
        Cell { z, row, col }
    }

    fn shuffle_connections(&mut self) {
        let mut s = self.hyper_parameters.shuffle_seed;
        for i in (1..self.unsolved_segs.len()).rev() {
            let next = s * 1664525.0 + 1013904223.0;
            let uint = next.trunc().rem_euclid(4294967296.0) as u32;
            s = (uint as i32) as f64;
            let rng = uint as f64 / 4294967295.0;
            let j = (rng * (i + 1) as f64).floor() as usize;
            self.unsolved_segs.swap(i, j);
        }
    }

    fn finalize_route(&mut self, goal_node_idx: usize) {
        self.consecutive_skips = self.consecutive_skips.saturating_sub(1);
        let mut cells = Vec::new();
        let mut idx = goal_node_idx as isize;
        while idx >= 0 {
            let n = &self.node_pool[idx as usize];
            cells.push(Cell {
                z: n.z,
                row: n.row,
                col: n.col,
            });
            idx = n.parent_idx;
        }
        cells.reverse();
        while cells.len() > 1 {
            let first = cells[0];
            let first_flat = ((first.z * self.rows + first.row) * self.cols + first.col) as usize;
            if !self.shared_cross_root_port_cells.contains(&first_flat) {
                break;
            }
            cells.remove(0);
        }
        while cells.len() > 1 {
            let last = cells[cells.len() - 1];
            let last_flat = ((last.z * self.rows + last.row) * self.cols + last.col) as usize;
            if !self.shared_cross_root_port_cells.contains(&last_flat) {
                break;
            }
            cells.pop();
        }
        let mut via_cells = Vec::new();
        for i in 1..cells.len() {
            if cells[i].z != cells[i - 1].z {
                via_cells.push((cells[i].row, cells[i].col));
            }
        }
        let first_cell = cells[0];
        let last_cell = cells[cells.len() - 1];
        let conn_id = self.active_conn_id;
        let mut ripped_ids = Vec::new();
        let mut cur = self.node_pool[goal_node_idx].ripped;
        while let Some(index) = cur {
            let node = &self.ripped_nodes[index];
            ripped_ids.push(node.id);
            cur = node.prev;
        }
        for &id in &ripped_ids {
            self.rip_trace(id);
            if self.failed {
                return;
            }
        }
        let margin_cells = (self.trace_margin / self.cell_size_mm).ceil() as i32;
        let mut indices = Vec::new();
        let rows = self.rows;
        let cols = self.cols;
        for cell in &cells {
            for dr in -margin_cells..=margin_cells {
                for dc in -margin_cells..=margin_cells {
                    let r = cell.row + dr;
                    let c = cell.col + dc;
                    if r < 0 || r >= rows || c < 0 || c >= cols {
                        continue;
                    }
                    let flat_idx = ((cell.z * rows + r) * cols + c) as usize;
                    if (r != cell.row || c != cell.col)
                        && self.should_skip_fixed_port_halo(flat_idx, conn_id)
                    {
                        continue;
                    }
                    let existing = self.used_cells_flat[flat_idx];
                    let same_root = self.conn_id_to_root_id.get(existing as usize)
                        == self.conn_id_to_root_id.get(conn_id as usize);
                    let allow_same_root_overlap =
                        same_root && self.conn_allows_root_overlap[conn_id as usize];
                    if existing != -1 && existing != conn_id && !allow_same_root_overlap {
                        continue;
                    }
                    self.used_cells_flat[flat_idx] = conn_id;
                    indices.push(flat_idx);
                }
            }
        }
        let mut displaced_by_vias = Vec::new();
        for &(via_row, via_col) in &via_cells {
            for z in 0..self.layers {
                let z_base = z as usize * self.plane_size;
                for oi in 0..self.via_offsets_len {
                    let r = via_row + self.via_offsets_dr[oi];
                    let c = via_col + self.via_offsets_dc[oi];
                    if r < 0 || r >= rows || c < 0 || c >= cols {
                        continue;
                    }
                    let flat_idx = z_base + (r * cols + c) as usize;
                    if (r != via_row || c != via_col)
                        && self.should_skip_fixed_port_halo(flat_idx, conn_id)
                    {
                        continue;
                    }
                    let existing = self.used_cells_flat[flat_idx];
                    let same_root = self.conn_id_to_root_id.get(existing as usize)
                        == self.conn_id_to_root_id.get(conn_id as usize);
                    let allow_same_root_overlap =
                        same_root && self.conn_allows_root_overlap[conn_id as usize];
                    if existing != -1 && existing != conn_id && !allow_same_root_overlap {
                        let mut seen = false;
                        for &id in &displaced_by_vias {
                            if id == existing {
                                seen = true;
                                break;
                            }
                        }
                        if !seen {
                            displaced_by_vias.push(existing);
                        }
                    }
                    self.used_cells_flat[flat_idx] = conn_id;
                    indices.push(flat_idx);
                }
            }
        }
        let mut diag_indices = Vec::new();
        let sq_cols = self.cols - 1;
        for i in 1..cells.len() {
            let prev = cells[i - 1];
            let curr = cells[i];
            if prev.z != curr.z {
                continue;
            }
            let dr = (prev.row - curr.row).abs();
            let dc = (prev.col - curr.col).abs();
            if dr != 1 || dc != 1 {
                continue;
            }
            let sq_row = prev.row.min(curr.row);
            let sq_col = prev.col.min(curr.col);
            let is_backslash = (prev.row < curr.row && prev.col < curr.col)
                || (prev.row > curr.row && prev.col > curr.col);
            let diag_slot = if is_backslash { 0 } else { 1 };
            let crossing_slot = diag_slot ^ 1;
            let diag_base = ((prev.z * (self.rows - 1) + sq_row) * sq_cols + sq_col) * 2;
            let crossing_idx = (diag_base + crossing_slot) as usize;
            let crossing_occ = self.used_diag_flat[crossing_idx];
            let crossing_same_root = self.conn_id_to_root_id.get(crossing_occ as usize)
                == self.conn_id_to_root_id.get(conn_id as usize);
            let allow_crossing_overlap =
                crossing_same_root && self.conn_allows_root_overlap[conn_id as usize];
            if crossing_occ != -1 && crossing_occ != conn_id && !allow_crossing_overlap {
                continue;
            }
            let diag_idx = (diag_base + diag_slot) as usize;
            self.used_diag_flat[diag_idx] = conn_id;
            diag_indices.push(diag_idx);
        }
        while self.used_indices_by_conn.len() <= conn_id as usize {
            self.used_indices_by_conn.push(Vec::new());
        }
        self.used_indices_by_conn[conn_id as usize].extend(indices);
        while self.used_diag_indices_by_conn.len() <= conn_id as usize {
            self.used_diag_indices_by_conn.push(Vec::new());
        }
        self.used_diag_indices_by_conn[conn_id as usize].extend(diag_indices);
        let route = SolvedRouteInternal {
            start_z: first_cell.z,
            start_row: first_cell.row,
            start_col: first_cell.col,
            start_point: self.active_conn_seg.as_ref().unwrap().start_point.clone(),
            end_z: last_cell.z,
            end_row: last_cell.row,
            end_col: last_cell.col,
            end_point: self.active_conn_seg.as_ref().unwrap().end_point.clone(),
            cells,
            via_cells,
        };
        if let Some((_, routes)) = self.solved_routes.iter_mut().find(|(id, _)| *id == conn_id) {
            routes.push(route);
        } else {
            self.solved_routes.push((conn_id, vec![route]));
        }
        for &id in &displaced_by_vias {
            self.rip_trace(id);
            if self.failed {
                return;
            }
        }
        if !ripped_ids.is_empty() || !displaced_by_vias.is_empty() {
            if self.total_rip_events > 50 {
                for pen in &mut self.penalty_2d {
                    *pen *= 0.99;
                }
            } else {
                for pen in &mut self.penalty_2d {
                    if *pen > self.penalty_cap {
                        *pen *= 0.5;
                    }
                }
            }
        }
    }

    fn rip_trace(&mut self, conn_id: ConnId) {
        while self.rip_count.len() <= conn_id as usize {
            self.rip_count.push(0);
        }
        self.rip_count[conn_id as usize] += 1;
        self.total_rip_events += 1;
        if self.total_rip_events >= self.max_rips {
            self.error = Some(format!(
                "Convergence failure: exceeded MAX_RIPS {}",
                self.max_rips
            ));
            self.failed = true;
            return;
        }
        let routes = self
            .solved_routes
            .iter()
            .find(|(id, _)| *id == conn_id)
            .map(|(_, routes)| routes.clone())
            .unwrap_or_default();
        if !routes.is_empty() {
            for route in &routes {
                for cell in &route.cells {
                    let cell_idx = (cell.row * self.cols + cell.col) as usize;
                    self.penalty_2d[cell_idx] += self.hyper_parameters.rip_trace_penalty;
                }
                for &(row, col) in &route.via_cells {
                    let via_idx = (row * self.cols + col) as usize;
                    self.penalty_2d[via_idx] += self.hyper_parameters.rip_via_penalty;
                }
            }
        }
        if let Some(indices) = self.used_indices_by_conn.get_mut(conn_id as usize) {
            for &flat_idx in indices.iter() {
                if self.used_cells_flat[flat_idx] == conn_id {
                    self.used_cells_flat[flat_idx] = -1;
                }
            }
            indices.clear();
        }
        if let Some(diag_indices) = self.used_diag_indices_by_conn.get_mut(conn_id as usize) {
            for &flat_idx in diag_indices.iter() {
                if self.used_diag_flat[flat_idx] == conn_id {
                    self.used_diag_flat[flat_idx] = -1;
                }
            }
            diag_indices.clear();
        }
        if !routes.is_empty() {
            let position = self
                .solved_routes
                .iter()
                .position(|(id, _)| *id == conn_id)
                .unwrap();
            self.solved_routes.remove(position);
            for route in routes {
                self.unsolved_segs.push_back(ConnectionSeg {
                    conn_id,
                    start_z: route.start_z,
                    start_row: route.start_row,
                    start_col: route.start_col,
                    start_point: route.start_point,
                    end_z: route.end_z,
                    end_row: route.end_row,
                    end_col: route.end_col,
                    end_point: route.end_point,
                });
            }
        }
    }

    pub fn visualize(&self) -> Value {
        let layer_colors = ["red", "blue", "orange", "green"];
        let mut points: Vec<Value> = Vec::new();
        let mut lines: Vec<Value> = Vec::new();
        let mut circles: Vec<Value> = Vec::new();
        let mut rects: Vec<Value> = Vec::new();
        let node = &self.node_with_port_points;
        rects.push(json!({
            "center": { "x": node["center"]["x"], "y": node["center"]["y"] },
            "width": node["width"], "height": node["height"], "stroke": "gray",
        }));
        if self.show_penalty_map {
            let mut max_penalty = 0.0;
            for &p in &self.penalty_2d {
                if p > max_penalty {
                    max_penalty = p;
                }
            }
            if max_penalty > 0.0 {
                let vt = self
                    .grid_to_bounds_transform
                    .as_ref()
                    .expect("grid transform must exist after setup");
                for row in 0..self.rows {
                    for col in 0..self.cols {
                        let p = self.penalty_2d[(row * self.cols + col) as usize];
                        if p <= 0.0 {
                            continue;
                        }
                        let alpha = 0.6_f64.min((p / max_penalty) * 0.6);
                        let tc = apply_affine_transform_to_point(
                            vt,
                            &crate::types::Point {
                                x: self.grid_origin.0 + (col as f64 + 0.5) * self.cell_size_mm,
                                y: self.grid_origin.1 + (row as f64 + 0.5) * self.cell_size_mm,
                            },
                        );
                        rects.push(json!({
                            "center": tc, "width": self.cell_size_mm * vt.a, "height": self.cell_size_mm * vt.e,
                            "fill": format!("rgba(255,165,0,{:.3})", alpha),
                        }));
                    }
                }
            }
        }
        if self.show_used_cell_map && !self.used_cells_flat.is_empty() {
            for z in 0..self.layers {
                for row in 0..self.rows {
                    for col in 0..self.cols {
                        let occ = self.used_cells_flat
                            [((z * self.rows + row) * self.cols + col) as usize];
                        if occ == -1 {
                            continue;
                        }
                        let vt = self
                            .grid_to_bounds_transform
                            .as_ref()
                            .expect("grid transform must exist after setup");
                        let tc = apply_affine_transform_to_point(
                            vt,
                            &crate::types::Point {
                                x: self.grid_origin.0 + (col as f64 + 0.5) * self.cell_size_mm,
                                y: self.grid_origin.1 + (row as f64 + 0.5) * self.cell_size_mm,
                            },
                        );
                        rects.push(json!({
                            "center": tc, "width": self.cell_size_mm * vt.a, "height": self.cell_size_mm * vt.e,
                            "fill": "rgba(0,0,255,0.5)",
                        }));
                    }
                }
            }
        }
        for pp in node["portPoints"]
            .as_array()
            .expect("portPoints is required")
        {
            let z = pp["z"].as_f64().expect("port z is required");
            let color = if z >= 0.0 && z.fract() == 0.0 {
                layer_colors.get(z as usize).copied().unwrap_or("gray")
            } else {
                "gray"
            };
            points.push(json!({ "x": pp["x"], "y": pp["y"], "color": color, "label": pp["connectionName"] }));
        }
        let trace_colors = [
            "rgba(255,0,0,0.75)",
            "rgba(0,0,255,0.75)",
            "rgba(255,165,0,0.75)",
            "rgba(0,128,0,0.75)",
        ];
        let transformed_routes = self.get_output();
        for route in transformed_routes.as_array().unwrap() {
            let route_points = route["route"].as_array().unwrap();
            if route_points.len() < 2 {
                continue;
            }
            let mut seg_start = 0;
            for i in 1..route_points.len() {
                let prev = &route_points[i - 1];
                let curr = &route_points[i];
                if curr["z"].as_f64() != prev["z"].as_f64() {
                    if i - seg_start >= 2 {
                        let z = prev["z"].as_f64().unwrap();
                        let color = if z >= 0.0 && z.fract() == 0.0 {
                            trace_colors
                                .get(z as usize)
                                .copied()
                                .unwrap_or("rgba(128,128,128,0.75)")
                        } else {
                            "rgba(128,128,128,0.75)"
                        };
                        lines.push(json!({
                            "points": route_points[seg_start..i].iter().map(|p| json!({ "x": p["x"], "y": p["y"] })).collect::<Vec<_>>(),
                            "strokeColor": color, "strokeWidth": self.trace_thickness,
                        }));
                    }
                    seg_start = i;
                }
            }
            if route_points.len() - seg_start >= 2 {
                let z = route_points[seg_start]["z"].as_f64().unwrap();
                let color = if z >= 0.0 && z.fract() == 0.0 {
                    trace_colors
                        .get(z as usize)
                        .copied()
                        .unwrap_or("rgba(128,128,128,0.75)")
                } else {
                    "rgba(128,128,128,0.75)"
                };
                lines.push(json!({
                    "points": route_points[seg_start..].iter().map(|p| json!({ "x": p["x"], "y": p["y"] })).collect::<Vec<_>>(),
                    "strokeColor": color, "strokeWidth": self.trace_thickness,
                }));
            }
        }
        for route in transformed_routes.as_array().unwrap() {
            for via in route["vias"].as_array().unwrap() {
                circles.push(json!({
                    "center": { "x": via["x"], "y": via["y"] }, "radius": self.via_diameter / 2.0,
                    "fill": "rgba(0,0,0,0.3)", "stroke": "black",
                }));
            }
        }
        if self.active_conn_seg.is_some() {
            let current_stamp = self.stamp;
            let vt = self
                .grid_to_bounds_transform
                .as_ref()
                .expect("grid transform must exist after setup");
            for z in 0..self.layers {
                for row in 0..self.rows {
                    for col in 0..self.cols {
                        if self.visited_stamp[((z * self.rows + row) * self.cols + col) as usize]
                            != current_stamp
                        {
                            continue;
                        }
                        let tc = apply_affine_transform_to_point(
                            vt,
                            &crate::types::Point {
                                x: self.grid_origin.0 + (col as f64 + 0.5) * self.cell_size_mm,
                                y: self.grid_origin.1 + (row as f64 + 0.5) * self.cell_size_mm,
                            },
                        );
                        points.push(json!({ "x": tc.x, "y": tc.y, "color": "rgba(0,0,255,0.2)" }));
                    }
                }
            }
        }
        json!({
            "points": points, "lines": lines, "circles": circles, "rects": rects, "coordinateSystem": "cartesian",
            "title": format!("HighDensityA01 [{} solved, {} remaining]", self.solved_routes.len(), self.unsolved_segs.len()),
        })
    }

    pub fn get_output(&self) -> Value {
        let mut result = Vec::new();
        for (conn_id, routes) in &self.solved_routes {
            let t = self
                .grid_to_bounds_transform
                .as_ref()
                .expect("grid transform must exist after setup");
            let conn_name = &self.conn_id_to_name[*conn_id as usize];
            for route in routes {
                let mut points: Vec<Value> = route.cells.iter().map(|cell| {
                    let raw_x = self.grid_origin.0 + (cell.col as f64 + 0.5) * self.cell_size_mm;
                    let raw_y = self.grid_origin.1 + (cell.row as f64 + 0.5) * self.cell_size_mm;
                    let tp = apply_affine_transform_to_point(t, &crate::types::Point { x: raw_x, y: raw_y });
                    json!({ "x": tp.x, "y": tp.y, "z": self.available_z.get(cell.z as usize).copied().unwrap_or(cell.z as f64) })
                }).collect();
                if !points.is_empty() {
                    points[0] = route.start_point.clone();
                    if points.len() > 1 {
                        let last = points.len() - 1;
                        points[last] = route.end_point.clone();
                    }
                }
                let mut output = json!({
                    "connectionName": conn_name, "rootConnectionName": self.conn_id_to_root_net[*conn_id as usize],
                    "regionId": self.node_with_port_points["capacityMeshNodeId"],
                    "traceThickness": self.trace_thickness, "viaDiameter": self.via_diameter,
                    "route": points,
                    "vias": route.via_cells.iter().map(|&(row, col)| {
                        let raw_x = self.grid_origin.0 + (col as f64 + 0.5) * self.cell_size_mm;
                        let raw_y = self.grid_origin.1 + (row as f64 + 0.5) * self.cell_size_mm;
                        apply_affine_transform_to_point(t, &crate::types::Point { x: raw_x, y: raw_y })
                    }).collect::<Vec<_>>(),
                });
                if self
                    .node_with_port_points
                    .get("capacityMeshNodeId")
                    .is_none()
                {
                    output.as_object_mut().unwrap().shift_remove("regionId");
                }
                result.push(output);
            }
        }
        Value::Array(result)
    }

    pub fn solved_segment_count(&self) -> usize {
        self.solved_routes
            .iter()
            .map(|(_, routes)| routes.len())
            .sum()
    }
}

#[cfg(test)]
mod allocation_tests {
    use super::*;

    #[test]
    fn rejected_diagonal_rips_release_only_the_unreferenced_tail() {
        let mut solver = HighDensitySolverA01::new(json!({"cellSizeMm":1.0,"viaDiameter":0.3}));
        solver.rows = 2;
        solver.cols = 2;
        solver.layers = 1;
        solver.penalty_2d = vec![0.0; 4];
        solver.port_owner_flat = vec![-1; 4];
        solver.used_cells_flat = vec![-1, -1, -1, 1];
        solver.used_diag_flat = vec![-1, 2];
        solver.conn_id_to_root_id = vec![0, 1, 2];
        solver.ripped_nodes.push(RippedNode { id: 3, prev: None });
        let active = ActiveConnection {
            id: 0,
            root_id: Some(0),
            allows_root_overlap: false,
        };
        solver.compute_move_cost_and_rips(active, 0, 0, 0, 0, 1, 1, Some(0));
        assert_eq!(solver.move_cost, -1.0);
        assert_eq!(solver.move_ripped, Some(0));
        assert_eq!(solver.ripped_nodes.len(), 1);
        assert_eq!(solver.ripped_nodes[0].id, 3);
        solver.used_diag_flat[1] = -1;
        solver.compute_move_cost_and_rips(active, 0, 0, 0, 0, 1, 1, Some(0));
        assert_eq!(solver.move_cost, std::f64::consts::SQRT_2 + 10.0 + 0.5);
        assert_eq!(solver.move_ripped, Some(1));
        assert_eq!(solver.ripped_nodes.len(), 2);
        assert_eq!(solver.ripped_nodes[1].prev, Some(0));
        assert_eq!(solver.ripped_nodes[1].id, 1);
        eprintln!(
            "SearchNode native size: {} bytes; RippedNode: {} bytes",
            std::mem::size_of::<SearchNode>(),
            std::mem::size_of::<RippedNode>()
        );

        solver.layers = 2;
        solver.plane_size = 4;
        solver.port_owner_flat = vec![-1; 8];
        solver.visited_stamp = vec![0; 8];
        solver.used_cells_flat = vec![1, 2, -1, -1, 2, 1, -1, -1];
        solver.via_offsets_dr = vec![0, 0];
        solver.via_offsets_dc = vec![0, 1];
        solver.via_offsets_len = 2;
        solver.fill_via_occupants(0, 0, active);
        assert_eq!(solver.via_occs, vec![1, 2]);
        solver.compute_move_cost_and_rips(active, 0, 0, 0, 1, 0, 0, None);
        let cold_cost = solver.move_cost.to_bits();
        let cold_head = solver.move_ripped.unwrap();
        solver.compute_move_cost_and_rips(active, 1, 0, 0, 0, 0, 0, None);
        assert_eq!(solver.move_cost.to_bits(), cold_cost);
        let warm_head = solver.move_ripped.unwrap();
        assert_eq!(solver.ripped_nodes[cold_head].id, 2);
        assert_eq!(solver.ripped_nodes[warm_head].id, 2);
        assert_eq!(solver.ripped_nodes[warm_head - 1].id, 1);
        assert_eq!(&*solver.via_occupants_by_cell[&0], &[1, 2]);
        solver.compute_move_cost_and_rips(active, 0, 0, 0, 1, 0, 0, Some(warm_head));
        assert_eq!(solver.move_ripped, Some(warm_head));
        assert_eq!(
            solver.move_cost,
            solver.hyper_parameters.via_base_cost + 2.0 * solver.hyper_parameters.rip_via_penalty
        );

        solver.used_cells_flat[0] = 0;
        solver.unsolved_segs.push_back(ConnectionSeg {
            conn_id: 1,
            start_z: 0,
            start_row: 0,
            start_col: 0,
            start_point: Value::Null,
            end_z: 1,
            end_row: 0,
            end_col: 0,
            end_point: Value::Null,
        });
        solver.step_once();
        assert!(solver.via_occupants_by_cell.is_empty());
        let next_active = ActiveConnection {
            id: 1,
            root_id: Some(1),
            allows_root_overlap: false,
        };
        solver.compute_move_cost_and_rips(next_active, 0, 0, 0, 1, 0, 0, None);
        assert_eq!(&*solver.via_occupants_by_cell[&0], &[0, 2]);
        solver.node_with_port_points = json!({
            "width": 2.0, "height": 2.0,
            "center": {"x": 0.0, "y": 0.0},
            "availableZ": [0, 1], "portPoints": [],
        });
        solver.setup();
        assert!(solver.via_occupants_by_cell.is_empty());
    }
}
