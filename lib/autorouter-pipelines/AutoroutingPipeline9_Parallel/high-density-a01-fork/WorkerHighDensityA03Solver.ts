/**
 * Worker-only derivative of @tscircuit/high-density-a01 at
 * 44005d6b9dde7d93a3d3a4815b4e7c8c52b59d34 (MIT, see ./LICENSE).
 * Native search, occupancy, queue and output behavior are preserved. The
 * callback-free grid-history worker owns immutable generated geometry; only
 * ordered geometric circle footprints and raw planar heuristics are reused.
 */
import { BaseSolver } from "@tscircuit/solver-utils"
import { getConnectionPortPointPairs } from "./getConnectionPortPointPairs"
import {
  type AffineTransform,
  applyAffineTransformToPoint,
} from "@tscircuit/high-density-a01"
import { computeMaxIterationsByNodeSizeAndConnectionCount } from "./maxIterationsByNodeSizeAndConnectionCount"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "@tscircuit/high-density-a01"

type ConnId = number
type GridCellIndex = number

type RegionName = "left" | "top" | "right" | "bottom" | "middle"

const REGION_LEFT = 0
const REGION_TOP = 1
const REGION_RIGHT = 2
const REGION_BOTTOM = 3
const REGION_MIDDLE = 4

const REGION_NAMES: RegionName[] = ["left", "top", "right", "bottom", "middle"]

interface RegionDef {
  id: number
  name: RegionName
  fineOriginRow: number
  fineOriginCol: number
  fineRows: number
  fineCols: number
  cellScale: number
  rows: number
  cols: number
  offset: number
}

interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startCellId: number
  startPoint: PortPoint
  endZ: number
  endCellId: number
  endPoint: PortPoint
}

interface SolvedRouteInternal {
  connId: ConnId
  states: Int32Array
  viaCellIds: Int32Array
  startPoint: PortPoint
  endPoint: PortPoint
}

interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

class TypedMinHeap {
  private f = new Float64Array(1024)
  private seq = new Uint32Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  push(f: number, seq: number, id: number) {
    this.ensureCapacity(this.n + 1)
    let i = this.n++
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!
      this.seq[0] = this.seq[this.n]!
      this.id[0] = this.id[this.n]!
      this.siftDown(0)
    }
    return out
  }

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private ensureCapacity(size: number) {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2

    const nf = new Float64Array(next)
    nf.set(this.f)
    this.f = nf

    const ns = new Uint32Array(next)
    ns.set(this.seq)
    this.seq = ns

    const ni = new Int32Array(next)
    ni.set(this.id)
    this.id = ni
  }

  private siftDown(i: number) {
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) return
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      if (this.less(i, m)) return
      this.swap(i, m)
      i = m
    }
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }

  private swap(i: number, j: number) {
    const tf = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tf

    const ts = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = ts

    const ti = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = ti
  }
}

class TypedNodePool {
  z = new Int32Array(1024)
  cellId = new Int32Array(1024)
  g = new Float64Array(1024)
  parent = new Int32Array(1024)
  ripHead = new Int32Array(1024).fill(-1)
  ripCount = new Int32Array(1024)
  length = 0

  clear() {
    this.length = 0
  }

  push(
    z: number,
    cellId: number,
    g: number,
    parent: number,
    ripHead: number,
    ripCount: number,
  ) {
    this.ensureCapacity(this.length + 1)
    const idx = this.length++
    this.z[idx] = z
    this.cellId[idx] = cellId
    this.g[idx] = g
    this.parent[idx] = parent
    this.ripHead[idx] = ripHead
    this.ripCount[idx] = ripCount
    return idx
  }

  private ensureCapacity(size: number) {
    if (size <= this.z.length) return
    let next = this.z.length
    while (next < size) next *= 2

    const nz = new Int32Array(next)
    nz.set(this.z)
    this.z = nz

    const nc = new Int32Array(next)
    nc.set(this.cellId)
    this.cellId = nc

    const ng = new Float64Array(next)
    ng.set(this.g)
    this.g = ng

    const np = new Int32Array(next)
    np.set(this.parent)
    this.parent = np

    const nr = new Int32Array(next)
    nr.fill(-1)
    nr.set(this.ripHead.subarray(0, this.length))
    this.ripHead = nr

    const nrc = new Int32Array(next)
    nrc.set(this.ripCount.subarray(0, this.length))
    this.ripCount = nrc
  }
}

class TypedRipChain {
  connId = new Int32Array(1024)
  prev = new Int32Array(1024).fill(-1)
  length = 0

  clear() {
    this.length = 0
  }

  append(prevHead: number, connId: number) {
    this.ensureCapacity(this.length + 1)
    const idx = this.length++
    this.connId[idx] = connId
    this.prev[idx] = prevHead
    return idx
  }

  contains(head: number, connId: number) {
    for (let cur = head; cur >= 0; cur = this.prev[cur]!) {
      if (this.connId[cur] === connId) return true
    }
    return false
  }

  collect(head: number, out: number[]) {
    out.length = 0
    for (let cur = head; cur >= 0; cur = this.prev[cur]!) {
      out.push(this.connId[cur]!)
    }
  }

  private ensureCapacity(size: number) {
    if (size <= this.connId.length) return
    let next = this.connId.length
    while (next < size) next *= 2

    const nc = new Int32Array(next)
    nc.set(this.connId)
    this.connId = nc

    const np = new Int32Array(next)
    np.fill(-1)
    np.set(this.prev.subarray(0, this.length))
    this.prev = np
  }
}

interface NeighborEdge {
  cellId: number
  cost: number
}

function toRootNetName(
  connectionName: string,
  rootConnectionName?: string,
): string {
  return rootConnectionName ?? connectionName.replace(/_mst\d+$/, "")
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pushUnique(arr: number[], value: number) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === value) return
  }
  arr.push(value)
}

function pushUniqueNeighbor(arr: NeighborEdge[], edge: NeighborEdge) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.cellId === edge.cellId) return
  }
  arr.push(edge)
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const qx = clamp(cx, minX, maxX)
  const qy = clamp(cy, minY, maxY)
  const dx = cx - qx
  const dy = cy - qy
  return dx * dx + dy * dy <= r * r
}

export interface HighDensitySolverA03Props {
  nodeWithPortPoints: NodeWithPortPoints
  highResolutionCellSize?: number
  highResolutionCellThickness?: number
  lowResolutionCellSize?: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier?: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  effort?: number
  /** Enable diagonal edges within each of the five grid regions. */
  enableDiagonalMoves?: boolean
  hyperParameters?: Partial<HyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    cellId: number
    region: RegionName
    row: number
    col: number
  }) => number
}

export class WorkerHighDensityA03Solver extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolverA03"
  }

  nodeWithPortPoints: NodeWithPortPoints
  highResolutionCellSize: number
  highResolutionCellThickness: number
  lowResolutionCellSize: number
  viaDiameter: number
  MAX_RIPS: number
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  effort: number
  enableDiagonalMoves: boolean
  stepMultiplier: number
  hyperParameters: HyperParameters
  initialPenaltyFn?: HighDensitySolverA03Props["initialPenaltyFn"]

  boundsMinX!: number
  boundsMaxX!: number
  boundsMinY!: number
  boundsMaxY!: number
  gridToBoundsTransform!: AffineTransform

  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>
  layers!: number

  fineRows!: number
  fineCols!: number
  lowScale!: number
  bandRows!: number
  bandCols!: number
  regions!: RegionDef[]

  planeSize!: number
  cellCenterX!: Float64Array
  cellCenterY!: Float64Array
  cellMinX!: Float64Array
  cellMinY!: Float64Array
  cellMaxX!: Float64Array
  cellMaxY!: Float64Array
  cellWidth!: Float64Array
  cellHeight!: Float64Array
  cellRegion!: Uint8Array
  cellRow!: Int32Array
  cellCol!: Int32Array
  viaAllowed!: Uint8Array
  neighborOffset!: Int32Array
  neighborIds!: Int32Array
  neighborCosts!: Float32Array

  private usedCellsFlat!: Int32Array
  private sharedCellsFlat!: Array<number[] | undefined>
  private portOwnerFlat!: Int32Array
  private penalty2d!: Float64Array
  private ripStateBuckets!: number
  private visitedStamp!: Uint32Array
  private bestGStamp!: Uint32Array
  private bestGValue!: Float64Array
  private visitedFlatStamp!: Uint32Array
  private sharedCrossRootPortFlat!: Uint8Array
  private stamp = 0

  private connNameToId!: Map<string, ConnId>
  private connIdToName!: string[]
  private connIdToRootNet!: string[]
  private overlapFriendlyRootNets!: Set<string>

  private usedIndicesByConn!: Array<number[] | undefined>
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Array<SolvedRouteInternal[] | undefined>

  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private nodePool!: TypedNodePool
  private heap!: TypedMinHeap
  private ripChain!: TypedRipChain
  private seqCounter = 0

  private _viaOccs: ConnId[] = []
  private viaOccupantsByCell = new Map<GridCellIndex, readonly ConnId[]>()
  private _cellOccs: ConnId[] = []
  private _rippedIds: ConnId[] = []
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number
  private baseSearchBudgetIters!: number

  private _moveCost = 0
  private _moveRippedHead = -1
  private _moveRipCount = 0

  private traceKeepoutRadius!: number
  private viaKeepoutRadius!: number


  // These caches never retain occupants: those remain per native search.
  private geometricViaCells = new Map<GridCellIndex, Int32Array>()
  private geometricViaBytes = 0
  private planarDistances = new Map<GridCellIndex, {
    distances: Float64Array
    valid: Uint8Array
  }>()
  private planarDistanceBytes = 0
  private readonly geometryMemoByteLimit = 8 * 1024 * 1024
  private readonly geometryMemoRowLimit = 8192

  get unsolvedConnections() {
    return this.unsolvedSegs
  }

  get solvedConnectionsMap() {
    const map = new Map<ConnId, SolvedRouteInternal[]>()
    for (let connId = 0; connId < this.solvedRoutes.length; connId++) {
      const routes = this.getSolvedRoutesForConn(connId)
      if (routes.length > 0) map.set(connId, routes)
    }
    return map
  }

  get activeConnection() {
    if (!this.activeConnSeg) return null
    const startCellId = this.activeConnSeg.startCellId
    const endCellId = this.activeConnSeg.endCellId
    return {
      connectionName: this.connIdToName[this.activeConnSeg.connId] ?? "",
      start: {
        cellId: startCellId,
        region: REGION_NAMES[this.cellRegion[startCellId]!]!,
        row: this.cellRow[startCellId]!,
        col: this.cellCol[startCellId]!,
        x: this.cellCenterX[startCellId]!,
        y: this.cellCenterY[startCellId]!,
        z: this.activeConnSeg.startZ,
      },
      end: {
        cellId: endCellId,
        region: REGION_NAMES[this.cellRegion[endCellId]!]!,
        row: this.cellRow[endCellId]!,
        col: this.cellCol[endCellId]!,
        x: this.cellCenterX[endCellId]!,
        y: this.cellCenterY[endCellId]!,
        z: this.activeConnSeg.endZ,
      },
    }
  }

  get openSet() {
    return { length: this.heap?.size ?? 0 }
  }

  get gridStats() {
    return {
      cells: this.planeSize || 0,
      layers: this.layers || 0,
      states: (this.planeSize || 0) * (this.layers || 0),
      ripStateBuckets: this.ripStateBuckets || 0,
      neighborEdges: this.neighborIds?.length ?? 0,
      regionCounts: this.regions
        ? Object.fromEntries(
            this.regions.map((region) => [
              region.name,
              region.rows * region.cols,
            ]),
          )
        : {},
    }
  }

  constructor(props: HighDensitySolverA03Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.highResolutionCellSize = props.highResolutionCellSize ?? 0.1
    this.highResolutionCellThickness = Math.max(
      1,
      Math.floor(props.highResolutionCellThickness ?? 8),
    )
    this.lowResolutionCellSize = props.lowResolutionCellSize ?? 0.4
    this.viaDiameter = props.viaDiameter
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.effort = props.effort ?? 1
    this.enableDiagonalMoves = props.enableDiagonalMoves ?? false
    this.stepMultiplier = Math.max(1, Math.floor(props.stepMultiplier ?? 1))
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 8,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      greedyMultiplier: 1.5,
      ...props.hyperParameters,
    }
    this.MAX_ITERATIONS = 100e6
    this.MAX_RIPS = 200
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override getConstructorParams(): [HighDensitySolverA03Props] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        highResolutionCellSize: this.highResolutionCellSize,
        highResolutionCellThickness: this.highResolutionCellThickness,
        lowResolutionCellSize: this.lowResolutionCellSize,
        viaDiameter: this.viaDiameter,
        maxCellCount: this.maxCellCount,
        stepMultiplier: this.stepMultiplier,
        traceThickness: this.traceThickness,
        traceMargin: this.traceMargin,
        viaMinDistFromBorder: this.viaMinDistFromBorder,
        showPenaltyMap: this.showPenaltyMap,
        showUsedCellMap: this.showUsedCellMap,
        effort: this.effort,
        enableDiagonalMoves: this.enableDiagonalMoves,
        hyperParameters: this.hyperParameters,
        initialPenaltyFn: this.initialPenaltyFn,
      },
    ]
  }

  override _setup(): void {
    this.geometricViaCells.clear()
    this.geometricViaBytes = 0
    this.planarDistances.clear()
    this.planarDistanceBytes = 0
    const { nodeWithPortPoints } = this
    const { width, height, center } = nodeWithPortPoints

    const rawScale = this.lowResolutionCellSize / this.highResolutionCellSize
    const roundedScale = Math.round(rawScale)
    if (
      !Number.isFinite(rawScale) ||
      rawScale <= 0 ||
      Math.abs(rawScale - roundedScale) > 1e-9
    ) {
      this.error =
        "lowResolutionCellSize must be a positive integer multiple of highResolutionCellSize"
      this.failed = true
      return
    }
    this.lowScale = Math.max(1, roundedScale)

    this.availableZ =
      nodeWithPortPoints.availableZ ??
      [...new Set(nodeWithPortPoints.portPoints.map((pp) => pp.z))].sort(
        (a, b) => a - b,
      )

    this.layers = this.availableZ.length
    this.zToLayer = new Map()
    this.layerToZ = new Map()
    for (let i = 0; i < this.availableZ.length; i++) {
      const z = this.availableZ[i]!
      this.zToLayer.set(z, i)
      this.layerToZ.set(i, z)
    }

    this.boundsMinX = center.x - width / 2
    this.boundsMaxX = center.x + width / 2
    this.boundsMinY = center.y - height / 2
    this.boundsMaxY = center.y + height / 2

    this.traceKeepoutRadius = this.traceMargin + this.traceThickness / 2
    this.viaKeepoutRadius = this.viaDiameter / 2 + this.traceKeepoutRadius

    this.buildFiveRegionGrid(width, height)
    this.gridToBoundsTransform = this.computeGridToBoundsTransform()

    const totalCells = this.layers * this.planeSize
    if (this.maxCellCount !== undefined && totalCells > this.maxCellCount) {
      this.error = `Cell count ${totalCells} exceeds maxCellCount ${this.maxCellCount}`
      this.failed = true
      return
    }

    this.connNameToId = new Map()
    this.connIdToName = []
    this.connIdToRootNet = []
    this.overlapFriendlyRootNets = new Set()

    this.unsolvedSegs = this.buildConnectionSegs()

    this.penalty2d = new Float64Array(this.planeSize)
    const widthInv = width > 0 ? 1 / width : 0
    const heightInv = height > 0 ? 1 / height : 0
    for (let cellId = 0; cellId < this.planeSize; cellId++) {
      let penalty = 0
      if (this.initialPenaltyFn) {
        penalty += this.initialPenaltyFn({
          x: this.cellCenterX[cellId]!,
          y: this.cellCenterY[cellId]!,
          px: (this.cellCenterX[cellId]! - this.boundsMinX) * widthInv,
          py: (this.cellCenterY[cellId]! - this.boundsMinY) * heightInv,
          cellId,
          region: REGION_NAMES[this.cellRegion[cellId]!]!,
          row: this.cellRow[cellId]!,
          col: this.cellCol[cellId]!,
        })
      }
      this.penalty2d[cellId] = penalty
    }

    this.usedCellsFlat = new Int32Array(totalCells).fill(-1)
    this.sharedCellsFlat = Array.from({ length: totalCells }, () => undefined)
    this.portOwnerFlat = new Int32Array(totalCells).fill(-1)
    this.sharedCrossRootPortFlat = new Uint8Array(totalCells)

    this.ripStateBuckets = 1
    const searchStateCount = totalCells
    this.visitedStamp = new Uint32Array(searchStateCount)
    this.bestGStamp = new Uint32Array(searchStateCount)
    this.bestGValue = new Float64Array(searchStateCount)
    this.visitedFlatStamp = new Uint32Array(totalCells)
    this.stamp = 0

    const rootByPortFlat = new Map<number, string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const connId = this.connNameToId.get(pp.connectionName)
      if (connId === undefined) continue
      const cell = this.pointToCell(pp)
      const flatIdx = cell.z * this.planeSize + cell.cellId
      const rootNet = this.connIdToRootNet[connId]!
      const existingRoot = rootByPortFlat.get(flatIdx)
      if (existingRoot === undefined) {
        rootByPortFlat.set(flatIdx, rootNet)
      } else if (existingRoot !== rootNet) {
        this.sharedCrossRootPortFlat[flatIdx] = 1
      }

      const existing = this.portOwnerFlat[flatIdx]!
      if (existing === -1 || existing === connId) {
        this.portOwnerFlat[flatIdx] = connId
      } else {
        this.portOwnerFlat[flatIdx] = -2
      }
    }
    this.solvedRoutes = []
    this.usedIndicesByConn = []
    this.ripCount = []
    this.consecutiveSkips = 0
    this.penaltyCap = this.hyperParameters.ripCost * 0.5
    this.shuffleConnections()
    const budget = computeMaxIterationsByNodeSizeAndConnectionCount({
      planeSize: this.planeSize,
      layers: this.layers,
      connectionCount: this.unsolvedSegs.length,
      effort: this.effort,
      maxIterations: this.MAX_ITERATIONS,
    })
    this.baseSearchBudgetIters = budget.baseSearchBudgetIters
    this.MAX_ITERATIONS = budget.maxIterationsIters

    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = new TypedNodePool()
    this.heap = new TypedMinHeap()
    this.ripChain = new TypedRipChain()
    this.seqCounter = 0
  }

  override _step(): void {
    for (let i = 0; i < this.stepMultiplier; i++) {
      if (this.solved || this.failed) return
      this.stepOnce()
    }
  }

  private buildFiveRegionGrid(width: number, height: number) {
    this.fineCols = Math.max(1, Math.ceil(width / this.highResolutionCellSize))
    this.fineRows = Math.max(1, Math.ceil(height / this.highResolutionCellSize))

    this.bandCols = Math.min(
      this.highResolutionCellThickness,
      Math.floor(this.fineCols / 2),
    )
    this.bandRows = Math.min(
      this.highResolutionCellThickness,
      Math.floor(this.fineRows / 2),
    )

    const middleFineCols = Math.max(0, this.fineCols - this.bandCols * 2)
    const middleFineRows = Math.max(0, this.fineRows - this.bandRows * 2)
    const topFineCols = middleFineCols
    const bottomFineCols = middleFineCols

    this.regions = [
      {
        id: REGION_LEFT,
        name: "left",
        fineOriginRow: 0,
        fineOriginCol: 0,
        fineRows: this.fineRows,
        fineCols: this.bandCols,
        cellScale: 1,
        rows: this.fineRows,
        cols: this.bandCols,
        offset: 0,
      },
      {
        id: REGION_TOP,
        name: "top",
        fineOriginRow: 0,
        fineOriginCol: this.bandCols,
        fineRows: this.bandRows,
        fineCols: topFineCols,
        cellScale: 1,
        rows: this.bandRows,
        cols: topFineCols,
        offset: 0,
      },
      {
        id: REGION_RIGHT,
        name: "right",
        fineOriginRow: 0,
        fineOriginCol: this.fineCols - this.bandCols,
        fineRows: this.fineRows,
        fineCols: this.bandCols,
        cellScale: 1,
        rows: this.fineRows,
        cols: this.bandCols,
        offset: 0,
      },
      {
        id: REGION_BOTTOM,
        name: "bottom",
        fineOriginRow: this.fineRows - this.bandRows,
        fineOriginCol: this.bandCols,
        fineRows: this.bandRows,
        fineCols: bottomFineCols,
        cellScale: 1,
        rows: this.bandRows,
        cols: bottomFineCols,
        offset: 0,
      },
      {
        id: REGION_MIDDLE,
        name: "middle",
        fineOriginRow: this.bandRows,
        fineOriginCol: this.bandCols,
        fineRows: middleFineRows,
        fineCols: middleFineCols,
        cellScale: this.lowScale,
        rows:
          middleFineRows > 0 ? Math.ceil(middleFineRows / this.lowScale) : 0,
        cols:
          middleFineCols > 0 ? Math.ceil(middleFineCols / this.lowScale) : 0,
        offset: 0,
      },
    ]

    let offset = 0
    for (let i = 0; i < this.regions.length; i++) {
      this.regions[i]!.offset = offset
      offset += this.regions[i]!.rows * this.regions[i]!.cols
    }
    this.planeSize = offset

    this.cellCenterX = new Float64Array(this.planeSize)
    this.cellCenterY = new Float64Array(this.planeSize)
    this.cellMinX = new Float64Array(this.planeSize)
    this.cellMinY = new Float64Array(this.planeSize)
    this.cellMaxX = new Float64Array(this.planeSize)
    this.cellMaxY = new Float64Array(this.planeSize)
    this.cellWidth = new Float64Array(this.planeSize)
    this.cellHeight = new Float64Array(this.planeSize)
    this.cellRegion = new Uint8Array(this.planeSize)
    this.cellRow = new Int32Array(this.planeSize)
    this.cellCol = new Int32Array(this.planeSize)
    this.viaAllowed = new Uint8Array(this.planeSize)

    for (let regionIdx = 0; regionIdx < this.regions.length; regionIdx++) {
      const region = this.regions[regionIdx]!
      for (let row = 0; row < region.rows; row++) {
        const fineRow0 = region.fineOriginRow + row * region.cellScale
        const fineRow1 = Math.min(
          region.fineOriginRow + region.fineRows,
          fineRow0 + region.cellScale,
        )
        const minY = this.boundsMinY + fineRow0 * this.highResolutionCellSize
        const maxY = Math.min(
          this.boundsMaxY,
          this.boundsMinY + fineRow1 * this.highResolutionCellSize,
        )
        for (let col = 0; col < region.cols; col++) {
          const fineCol0 = region.fineOriginCol + col * region.cellScale
          const fineCol1 = Math.min(
            region.fineOriginCol + region.fineCols,
            fineCol0 + region.cellScale,
          )
          const minX = this.boundsMinX + fineCol0 * this.highResolutionCellSize
          const maxX = Math.min(
            this.boundsMaxX,
            this.boundsMinX + fineCol1 * this.highResolutionCellSize,
          )
          const cellId = this.cellIdFor(region.id, row, col)
          this.cellCenterX[cellId] = (minX + maxX) / 2
          this.cellCenterY[cellId] = (minY + maxY) / 2
          this.cellMinX[cellId] = minX
          this.cellMinY[cellId] = minY
          this.cellMaxX[cellId] = maxX
          this.cellMaxY[cellId] = maxY
          this.cellWidth[cellId] = maxX - minX
          this.cellHeight[cellId] = maxY - minY
          this.cellRegion[cellId] = region.id
          this.cellRow[cellId] = row
          this.cellCol[cellId] = col

          const minBorderDist = Math.min(
            this.cellCenterX[cellId]! - this.boundsMinX,
            this.boundsMaxX - this.cellCenterX[cellId]!,
            this.cellCenterY[cellId]! - this.boundsMinY,
            this.boundsMaxY - this.cellCenterY[cellId]!,
          )
          this.viaAllowed[cellId] =
            minBorderDist >= this.viaMinDistFromBorder ? 1 : 0
        }
      }
    }

    const neighbors: NeighborEdge[][] = Array.from(
      { length: this.planeSize },
      () => [],
    )
    const addBidirectionalEdge = (a: number, b: number) => {
      if (a === b || a < 0 || b < 0) return
      const dx = this.cellCenterX[a]! - this.cellCenterX[b]!
      const dy = this.cellCenterY[a]! - this.cellCenterY[b]!
      const cost = Math.hypot(dx, dy)
      pushUniqueNeighbor(neighbors[a]!, { cellId: b, cost })
      pushUniqueNeighbor(neighbors[b]!, { cellId: a, cost })
    }

    for (let regionIdx = 0; regionIdx < this.regions.length; regionIdx++) {
      const region = this.regions[regionIdx]!
      for (let row = 0; row < region.rows; row++) {
        for (let col = 0; col < region.cols; col++) {
          const cellId = this.cellIdFor(region.id, row, col)
          if (row + 1 < region.rows) {
            addBidirectionalEdge(
              cellId,
              this.cellIdFor(region.id, row + 1, col),
            )
          }
          if (col + 1 < region.cols) {
            addBidirectionalEdge(
              cellId,
              this.cellIdFor(region.id, row, col + 1),
            )
          }
          if (this.enableDiagonalMoves && row + 1 < region.rows) {
            if (col + 1 < region.cols) {
              addBidirectionalEdge(
                cellId,
                this.cellIdFor(region.id, row + 1, col + 1),
              )
            }
            if (col > 0) {
              addBidirectionalEdge(
                cellId,
                this.cellIdFor(region.id, row + 1, col - 1),
              )
            }
          }
        }
      }
    }

    const left = this.regions[REGION_LEFT]!
    const top = this.regions[REGION_TOP]!
    const right = this.regions[REGION_RIGHT]!
    const bottom = this.regions[REGION_BOTTOM]!
    const middle = this.regions[REGION_MIDDLE]!
    const hasLeft = left.rows > 0 && left.cols > 0
    const hasTop = top.rows > 0 && top.cols > 0
    const hasRight = right.rows > 0 && right.cols > 0
    const hasBottom = bottom.rows > 0 && bottom.cols > 0
    const hasMiddle = middle.rows > 0 && middle.cols > 0

    if (hasLeft && hasTop) {
      for (let globalRow = 0; globalRow < this.bandRows; globalRow++) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
          this.cellIdFor(REGION_TOP, globalRow, 0),
        )
      }
    }

    if (hasTop && hasRight) {
      for (let globalRow = 0; globalRow < this.bandRows; globalRow++) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_TOP, globalRow, top.cols - 1),
          this.cellIdFor(REGION_RIGHT, globalRow, 0),
        )
      }
    }

    if (hasLeft && hasBottom) {
      for (
        let globalRow = this.fineRows - this.bandRows;
        globalRow < this.fineRows;
        globalRow++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
          this.cellIdFor(
            REGION_BOTTOM,
            globalRow - (this.fineRows - this.bandRows),
            0,
          ),
        )
      }
    }

    if (hasBottom && hasRight) {
      for (
        let globalRow = this.fineRows - this.bandRows;
        globalRow < this.fineRows;
        globalRow++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(
            REGION_BOTTOM,
            globalRow - (this.fineRows - this.bandRows),
            bottom.cols - 1,
          ),
          this.cellIdFor(REGION_RIGHT, globalRow, 0),
        )
      }
    }

    if (hasLeft && hasMiddle) {
      for (
        let globalRow = this.bandRows;
        globalRow < this.fineRows - this.bandRows;
        globalRow++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_LEFT, globalRow, left.cols - 1),
          this.cellIdFor(
            REGION_MIDDLE,
            Math.floor((globalRow - this.bandRows) / this.lowScale),
            0,
          ),
        )
      }
    }

    if (hasRight && hasMiddle) {
      for (
        let globalRow = this.bandRows;
        globalRow < this.fineRows - this.bandRows;
        globalRow++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(
            REGION_MIDDLE,
            Math.floor((globalRow - this.bandRows) / this.lowScale),
            middle.cols - 1,
          ),
          this.cellIdFor(REGION_RIGHT, globalRow, 0),
        )
      }
    }

    if (hasTop && hasMiddle) {
      for (
        let globalCol = this.bandCols;
        globalCol < this.fineCols - this.bandCols;
        globalCol++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_TOP, top.rows - 1, globalCol - this.bandCols),
          this.cellIdFor(
            REGION_MIDDLE,
            0,
            Math.floor((globalCol - this.bandCols) / this.lowScale),
          ),
        )
      }
    }

    if (hasBottom && hasMiddle) {
      for (
        let globalCol = this.bandCols;
        globalCol < this.fineCols - this.bandCols;
        globalCol++
      ) {
        addBidirectionalEdge(
          this.cellIdFor(
            REGION_MIDDLE,
            middle.rows - 1,
            Math.floor((globalCol - this.bandCols) / this.lowScale),
          ),
          this.cellIdFor(REGION_BOTTOM, 0, globalCol - this.bandCols),
        )
      }
    }

    // Degenerate small-node cases can collapse away the middle and one axis of
    // edge bands. In those layouts, the remaining opposing regions still share
    // a seam and must be connected directly.
    if (!hasMiddle && !hasTop && !hasBottom && hasLeft && hasRight) {
      for (let row = 0; row < Math.min(left.rows, right.rows); row++) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_LEFT, row, left.cols - 1),
          this.cellIdFor(REGION_RIGHT, row, 0),
        )
      }
    }

    if (!hasMiddle && !hasLeft && !hasRight && hasTop && hasBottom) {
      for (let col = 0; col < Math.min(top.cols, bottom.cols); col++) {
        addBidirectionalEdge(
          this.cellIdFor(REGION_TOP, top.rows - 1, col),
          this.cellIdFor(REGION_BOTTOM, 0, col),
        )
      }
    }

    const flattened = this.flattenNeighborLists(neighbors)
    this.neighborOffset = flattened.offset
    this.neighborIds = flattened.ids
    this.neighborCosts = flattened.costs
  }

  private cellIdFor(regionId: number, row: number, col: number) {
    const region = this.regions[regionId]!
    return region.offset + row * region.cols + col
  }

  private stepOnce(): void {
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        this.solved = true
        return
      }

      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId

      // Via occupants are independent of the search layer and ripped path.
      // A new connection must see copper changes made by the previous search.
      this.viaOccupantsByCell.clear()

      this.nodePool.clear()
      this.ripChain.clear()
      this.heap.clear()
      this.seqCounter = 0
      this.searchIterations = 0
      this.nextStamp()

      const h = this.computeH(
        next.startZ,
        next.startCellId,
        next.endZ,
        next.endCellId,
      )
      const f = h * this.hyperParameters.greedyMultiplier
      const startIdx = this.nodePool.push(
        next.startZ,
        next.startCellId,
        0,
        -1,
        -1,
        0,
      )
      const startFlatIdx = next.startZ * this.planeSize + next.startCellId
      const startStateIdx = this.getSearchStateIdx(startFlatIdx, 0)
      this.bestGStamp[startStateIdx] = this.stamp
      this.bestGValue[startStateIdx] = 0
      this.heap.push(f, this.seqCounter++, startIdx)
      return
    }

    this.searchIterations++
    const connRips = this.ripCount[this.activeConnId] ?? 0
    const budget = Math.round(
      this.baseSearchBudgetIters * (1 + Math.min(connRips, 10) * 0.25),
    )
    if (this.searchIterations > budget) {
      const pen = this.penalty2d
      for (let i = 0; i < pen.length; i++) {
        pen[i] = pen[i]! * 0.9
      }
      this.unsolvedSegs.push(this.activeConnSeg)
      this.activeConnSeg = null
      this.activeConnId = -1
      this.heap.clear()
      this.nodePool.clear()
      this.consecutiveSkips++
      if (this.consecutiveSkips >= Math.max(3, this.unsolvedSegs.length * 3)) {
        this.error = `Convergence failure: ${this.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
      return
    }

    if (this.heap.size === 0) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      return
    }

    const nodeIdx = this.heap.pop()
    const z = this.nodePool.z[nodeIdx]!
    const cellId = this.nodePool.cellId[nodeIdx]!
    const g = this.nodePool.g[nodeIdx]!
    const rippedHead = this.nodePool.ripHead[nodeIdx]!
    const ripCount = this.nodePool.ripCount[nodeIdx]!

    const flatIdx = z * this.planeSize + cellId
    const searchStateIdx = this.getSearchStateIdx(flatIdx, ripCount)
    if (this.visitedStamp[searchStateIdx] === this.stamp) return
    this.visitedStamp[searchStateIdx] = this.stamp
    this.visitedFlatStamp[flatIdx] = this.stamp

    const seg = this.activeConnSeg
    if (z === seg.endZ && cellId === seg.endCellId) {
      this.finalizeRoute(nodeIdx)
      this.activeConnSeg = null
      this.activeConnId = -1
      return
    }

    const visited = this.visitedStamp
    const stamp = this.stamp
    const activeConn = this.activeConnId
    const endZ = seg.endZ
    const endCellId = seg.endCellId
    const neighborStart = this.neighborOffset[cellId]!
    const neighborEnd = this.neighborOffset[cellId + 1]!

    for (let i = neighborStart; i < neighborEnd; i++) {
      const neighborCellId = this.neighborIds[i]!
      const nextFlatIdx = z * this.planeSize + neighborCellId

      this.computeMoveCostAndRips(
        activeConn,
        z,
        neighborCellId,
        false,
        rippedHead,
        ripCount,
        this.neighborCosts[i]!,
      )
      if (this._moveCost < 0) continue

      const nextStateIdx = this.getSearchStateIdx(
        nextFlatIdx,
        this._moveRipCount,
      )
      if (visited[nextStateIdx] === stamp) continue

      const g2 = g + this._moveCost
      if (
        this.bestGStamp[nextStateIdx] === stamp &&
        g2 >= this.bestGValue[nextStateIdx]!
      ) {
        continue
      }
      this.bestGStamp[nextStateIdx] = stamp
      this.bestGValue[nextStateIdx] = g2
      const f2 =
        g2 +
        this.computeH(z, neighborCellId, endZ, endCellId) *
          this.hyperParameters.greedyMultiplier

      const newNodeIdx = this.nodePool.push(
        z,
        neighborCellId,
        g2,
        nodeIdx,
        this._moveRippedHead,
        this._moveRipCount,
      )
      this.heap.push(f2, this.seqCounter++, newNodeIdx)
    }

    if (this.viaAllowed[cellId]) {
      for (let nz = 0; nz < this.layers; nz++) {
        if (nz === z) continue
        const nextFlatIdx = nz * this.planeSize + cellId

        this.computeMoveCostAndRips(
          activeConn,
          nz,
          cellId,
          true,
          rippedHead,
          ripCount,
          0,
        )
        if (this._moveCost < 0) continue

        const nextStateIdx = this.getSearchStateIdx(
          nextFlatIdx,
          this._moveRipCount,
        )
        if (visited[nextStateIdx] === stamp) continue

        const g2 = g + this._moveCost
        if (
          this.bestGStamp[nextStateIdx] === stamp &&
          g2 >= this.bestGValue[nextStateIdx]!
        ) {
          continue
        }
        this.bestGStamp[nextStateIdx] = stamp
        this.bestGValue[nextStateIdx] = g2
        const f2 =
          g2 +
          this.computeH(nz, cellId, endZ, endCellId) *
            this.hyperParameters.greedyMultiplier

        const newNodeIdx = this.nodePool.push(
          nz,
          cellId,
          g2,
          nodeIdx,
          this._moveRippedHead,
          this._moveRipCount,
        )
        this.heap.push(f2, this.seqCounter++, newNodeIdx)
      }
    }
  }

  private computeMoveCostAndRips(
    activeConn: ConnId,
    toZ: number,
    toCellId: number,
    isVia: boolean,
    rippedHead: number,
    currentRipCount: number,
    lateralCost: number,
  ): void {
    let cost = 0
    let head = rippedHead
    let ripCount = currentRipCount
    const toFlatIdx = toZ * this.planeSize + toCellId

    if (isVia) {
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const allowFixedOverlap = this.allowSharedUse(activeConn, fixedOwner)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      this.fillViaOccupants(toCellId, activeConn)
      const occs = this._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
          ripCount++
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      cost += lateralCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const allowFixedOverlap = this.allowSharedUse(activeConn, fixedOwner)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      this.fillTraceOccupants(toFlatIdx, activeConn, this._cellOccs)
      for (let i = 0; i < this._cellOccs.length; i++) {
        const occ = this._cellOccs[i]!
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
          ripCount++
        }
        cost += this.hyperParameters.ripTracePenalty
      }
    }

    this._moveCost = cost
    this._moveRippedHead = head
    this._moveRipCount = ripCount
  }

  private fillViaOccupants(cellId: number, activeConn: ConnId): void {
    const occs = this._viaOccs
    occs.length = 0
    const cachedOccupants = this.viaOccupantsByCell.get(cellId)
    if (cachedOccupants) {
      for (const connId of cachedOccupants) occs.push(connId)
      return
    }
    let geometricCells = this.geometricViaCells.get(cellId)
    if (!geometricCells) {
      const cx = this.cellCenterX[cellId]!
      const cy = this.cellCenterY[cellId]!
      const intersectingCells: number[] = []
      this.forEachCellNearCircle(cx, cy, this.viaKeepoutRadius, (occCellId: number): void => {
        if (
          !circleIntersectsRect(
            cx,
            cy,
            this.viaKeepoutRadius,
            this.cellMinX[occCellId]!,
            this.cellMinY[occCellId]!,
            this.cellMaxX[occCellId]!,
            this.cellMaxY[occCellId]!,
          )
        ) {
          return
        }
        intersectingCells.push(occCellId)
      })
      geometricCells = Int32Array.from(intersectingCells)
      if (
        this.geometricViaCells.size < this.geometryMemoRowLimit &&
        this.geometricViaBytes + geometricCells.byteLength <= this.geometryMemoByteLimit
      ) {
        this.geometricViaCells.set(cellId, geometricCells)
        this.geometricViaBytes += geometricCells.byteLength
      }
    }
    for (let index = 0; index < geometricCells.length; index++) {
      const occCellId = geometricCells[index]!
      for (let z = 0; z < this.layers; z++) {
        this.pushFlatOccupants(z * this.planeSize + occCellId, activeConn, occs)
      }
    }
    this.viaOccupantsByCell.set(cellId, occs.slice())
  }

  private fillTraceOccupants(
    flatIdx: number,
    activeConn: ConnId,
    out: ConnId[],
  ): void {
    out.length = 0
    this.pushFlatOccupants(flatIdx, activeConn, out)
  }

  private pushFlatOccupants(
    flatIdx: number,
    activeConn: ConnId,
    out: ConnId[],
  ): void {
    const primaryOcc = this.usedCellsFlat[flatIdx]!
    if (
      primaryOcc !== -1 &&
      primaryOcc !== activeConn &&
      !this.allowSharedUse(activeConn, primaryOcc)
    ) {
      pushUnique(out, primaryOcc)
    }

    const sharedOccs = this.sharedCellsFlat[flatIdx]
    if (!sharedOccs) return
    for (let i = 0; i < sharedOccs.length; i++) {
      const occ = sharedOccs[i]!
      if (occ === activeConn) continue
      if (this.allowSharedUse(activeConn, occ)) continue
      pushUnique(out, occ)
    }
  }

  private addSharedOccupant(flatIdx: number, connId: ConnId): void {
    const primaryOcc = this.usedCellsFlat[flatIdx]!
    if (primaryOcc === connId) return
    let sharedOccs = this.sharedCellsFlat[flatIdx]
    if (!sharedOccs) {
      sharedOccs = []
      this.sharedCellsFlat[flatIdx] = sharedOccs
    }
    pushUnique(sharedOccs, connId)
  }

  private replaceOccupants(flatIdx: number, connId: ConnId): void {
    this.usedCellsFlat[flatIdx] = connId
    this.sharedCellsFlat[flatIdx] = undefined
  }

  private removeOccupant(flatIdx: number, connId: ConnId): void {
    const sharedOccs = this.sharedCellsFlat[flatIdx]
    if (this.usedCellsFlat[flatIdx] === connId) {
      if (sharedOccs && sharedOccs.length > 0) {
        this.usedCellsFlat[flatIdx] = sharedOccs.pop()!
        if (sharedOccs.length === 0) {
          this.sharedCellsFlat[flatIdx] = undefined
        }
      } else {
        this.usedCellsFlat[flatIdx] = -1
      }
      return
    }

    if (!sharedOccs) return
    const idx = sharedOccs.indexOf(connId)
    if (idx === -1) return
    sharedOccs.splice(idx, 1)
    if (sharedOccs.length === 0) {
      this.sharedCellsFlat[flatIdx] = undefined
    }
  }

  private allowSharedUse(activeConn: ConnId, existingConn: ConnId) {
    if (existingConn < 0) return false
    const sameRoot =
      this.connIdToRootNet[existingConn] === this.connIdToRootNet[activeConn]
    return sameRoot
  }

  private shouldSkipFixedPortHalo(flatIdx: number, connId: ConnId) {
    const fixedOwner = this.portOwnerFlat[flatIdx]!
    if (fixedOwner === connId) return false
    if (fixedOwner === -2) return true
    if (fixedOwner < 0) return false
    return !this.allowSharedUse(connId, fixedOwner)
  }

  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.bestGStamp.fill(0)
      this.visitedFlatStamp.fill(0)
      this.stamp = 1
    }
  }

  private getSearchStateIdx(flatIdx: number, ripCount: number) {
    void ripCount
    return flatIdx
  }

  private computeH(
    z: number,
    cellId: number,
    toZ: number,
    toCellId: number,
  ): number {
    let table = this.planarDistances.get(toCellId)
    if (!table && this.planarDistances.size < this.geometryMemoRowLimit) {
      const tableBytes = this.planeSize * (Float64Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT)
      if (this.planarDistanceBytes + tableBytes <= this.geometryMemoByteLimit) {
        table = {
          distances: new Float64Array(this.planeSize),
          valid: new Uint8Array(this.planeSize),
        }
        this.planarDistances.set(toCellId, table)
        this.planarDistanceBytes += tableBytes
      }
    }
    let dist: number
    if (table && table.valid[cellId] === 1) {
      dist = table.distances[cellId]!
    } else {
      dist = Math.hypot(
        this.cellCenterX[cellId]! - this.cellCenterX[toCellId]!,
        this.cellCenterY[cellId]! - this.cellCenterY[toCellId]!,
      )
      if (table) {
        table.distances[cellId] = dist
        table.valid[cellId] = 1
      }
    }

    if (z === toZ) return dist
    return dist + this.hyperParameters.viaBaseCost
  }

  private internConn(name: string, rootNetName?: string): ConnId {
    const existing = this.connNameToId.get(name)
    if (existing !== undefined) return existing
    const id = this.connIdToName.length
    this.connIdToName.push(name)
    this.connIdToRootNet.push(toRootNetName(name, rootNetName))
    this.connNameToId.set(name, id)
    return id
  }

  private buildConnectionSegs(): ConnectionSeg[] {
    const byName = new Map<
      string,
      {
        points: PortPoint[]
        rootConnectionName?: string
      }
    >()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const name = pp.connectionName
      if (!byName.has(name)) {
        byName.set(name, {
          points: [],
          rootConnectionName: pp.rootConnectionName,
        })
      }
      byName.get(name)!.points.push(pp)
    }

    const segs: ConnectionSeg[] = []
    const seenSegmentKeys = new Set<string>()

    for (const [name, conn] of byName) {
      const pts = conn.points
      const pointPairs = getConnectionPortPointPairs(pts)
      if (pointPairs.length === 0) continue

      const connId = this.internConn(name, conn.rootConnectionName)
      for (const [startPoint, endPoint] of pointPairs) {
        const s = this.pointToCell(startPoint)
        const e = this.pointToCell(endPoint)

        const endpointA = `${s.z}:${s.cellId}`
        const endpointB = `${e.z}:${e.cellId}`
        const orderedEndpoints =
          endpointA < endpointB
            ? `${endpointA}|${endpointB}`
            : `${endpointB}|${endpointA}`
        const netName = conn.rootConnectionName ?? name
        const segKey = `${netName}|${orderedEndpoints}`
        if (seenSegmentKeys.has(segKey)) {
          this.overlapFriendlyRootNets.add(netName)
          continue
        }
        seenSegmentKeys.add(segKey)

        segs.push({
          connId,
          startZ: s.z,
          startCellId: s.cellId,
          startPoint,
          endZ: e.z,
          endCellId: e.cellId,
          endPoint,
        })
      }
    }

    return segs
  }

  private pointToCell(pt: { x: number; y: number; z: number }) {
    const fineCol = clamp(
      Math.floor((pt.x - this.boundsMinX) / this.highResolutionCellSize),
      0,
      this.fineCols - 1,
    )
    const fineRow = clamp(
      Math.floor((pt.y - this.boundsMinY) / this.highResolutionCellSize),
      0,
      this.fineRows - 1,
    )

    let regionId = REGION_MIDDLE
    if (fineCol < this.bandCols) {
      regionId = REGION_LEFT
    } else if (fineCol >= this.fineCols - this.bandCols) {
      regionId = REGION_RIGHT
    } else if (fineRow < this.bandRows) {
      regionId = REGION_TOP
    } else if (fineRow >= this.fineRows - this.bandRows) {
      regionId = REGION_BOTTOM
    }

    const region = this.regions[regionId]!
    const localFineRow = fineRow - region.fineOriginRow
    const localFineCol = fineCol - region.fineOriginCol
    const row = clamp(
      Math.floor(localFineRow / region.cellScale),
      0,
      Math.max(0, region.rows - 1),
    )
    const col = clamp(
      Math.floor(localFineCol / region.cellScale),
      0,
      Math.max(0, region.cols - 1),
    )

    return {
      z: this.zToLayer.get(pt.z) ?? 0,
      cellId: this.cellIdFor(regionId, row, col),
    }
  }

  private shuffleConnections(): void {
    const arr = this.unsolvedSegs
    let s = this.hyperParameters.shuffleSeed >>> 0
    const rng = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 0xffffffff
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
  }

  private finalizeRoute(goalNodeIdx: number): void {
    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)

    const states: number[] = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const z = this.nodePool.z[idx]!
      const cellId = this.nodePool.cellId[idx]!
      states.push(z * this.planeSize + cellId)
      idx = this.nodePool.parent[idx]!
    }
    states.reverse()

    while (states.length > 1) {
      if (!this.sharedCrossRootPortFlat[states[0]!]!) break
      states.shift()
    }
    while (states.length > 1) {
      if (!this.sharedCrossRootPortFlat[states[states.length - 1]!]!) break
      states.pop()
    }

    const viaCellIds = this.extractViaCellIds(states)
    const connId = this.activeConnId
    this.ripChain.collect(this.nodePool.ripHead[goalNodeIdx]!, this._rippedIds)

    for (let i = 0; i < this._rippedIds.length; i++) {
      this.ripTrace(this._rippedIds[i]!)
      if (this.failed) return
    }

    const indices: number[] = []
    for (let i = 0; i < states.length; i++) {
      const state = states[i]!
      const z = Math.floor(state / this.planeSize)
      const cellId = state - z * this.planeSize
      this.markTraceFootprint(connId, z, cellId, indices)
    }

    const displacedByVias: ConnId[] = []
    for (let i = 0; i < viaCellIds.length; i++) {
      this.markViaFootprint(connId, viaCellIds[i]!, indices, displacedByVias)
    }

    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push(undefined)
    }
    const usedIndices = this.usedIndicesByConn[connId] ?? []
    usedIndices.push(...indices)
    this.usedIndicesByConn[connId] = usedIndices
    while (this.solvedRoutes.length <= connId) {
      this.solvedRoutes.push(undefined)
    }
    const solvedRoutes = this.solvedRoutes[connId] ?? []
    solvedRoutes.push({
      connId,
      states: Int32Array.from(states),
      viaCellIds: Int32Array.from(viaCellIds),
      startPoint: this.activeConnSeg!.startPoint,
      endPoint: this.activeConnSeg!.endPoint,
    })
    this.solvedRoutes[connId] = solvedRoutes

    for (let i = 0; i < displacedByVias.length; i++) {
      this.ripTrace(displacedByVias[i]!)
      if (this.failed) return
    }

    if (this._rippedIds.length > 0 || displacedByVias.length > 0) {
      const pen = this.penalty2d
      const cap = this.penaltyCap
      if (this.totalRipEvents > 50) {
        for (let i = 0; i < pen.length; i++) {
          pen[i] = pen[i]! * 0.99
        }
      } else {
        for (let i = 0; i < pen.length; i++) {
          if (pen[i]! > cap) {
            pen[i] = pen[i]! * 0.5
          }
        }
      }
    }
  }

  private extractViaCellIds(states: number[]) {
    const viaCellIds: number[] = []
    for (let i = 1; i < states.length; i++) {
      const prevState = states[i - 1]!
      const nextState = states[i]!
      const prevZ = Math.floor(prevState / this.planeSize)
      const nextZ = Math.floor(nextState / this.planeSize)
      if (prevZ !== nextZ) {
        viaCellIds.push(nextState - nextZ * this.planeSize)
      }
    }
    return viaCellIds
  }

  private markTraceFootprint(
    connId: ConnId,
    z: number,
    sourceCellId: number,
    indices: number[],
  ) {
    const cx = this.cellCenterX[sourceCellId]!
    const cy = this.cellCenterY[sourceCellId]!
    this.forEachCellNearCircle(cx, cy, this.traceKeepoutRadius, (cellId) => {
      if (
        !circleIntersectsRect(
          cx,
          cy,
          this.traceKeepoutRadius,
          this.cellMinX[cellId]!,
          this.cellMinY[cellId]!,
          this.cellMaxX[cellId]!,
          this.cellMaxY[cellId]!,
        )
      ) {
        return
      }
      const flatIdx = z * this.planeSize + cellId
      if (
        cellId !== sourceCellId &&
        this.shouldSkipFixedPortHalo(flatIdx, connId)
      ) {
        return
      }
      const existing = this.usedCellsFlat[flatIdx]!
      const allowSameRootOverlap = this.allowSharedUse(connId, existing)
      if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
        return
      }
      if (existing !== -1 && existing !== connId) {
        this.addSharedOccupant(flatIdx, connId)
      } else {
        this.usedCellsFlat[flatIdx] = connId
      }
      indices.push(flatIdx)
    })
  }

  private markViaFootprint(
    connId: ConnId,
    sourceCellId: number,
    indices: number[],
    displacedByVias: ConnId[],
  ) {
    const cx = this.cellCenterX[sourceCellId]!
    const cy = this.cellCenterY[sourceCellId]!
    this.forEachCellNearCircle(cx, cy, this.viaKeepoutRadius, (cellId) => {
      if (
        !circleIntersectsRect(
          cx,
          cy,
          this.viaKeepoutRadius,
          this.cellMinX[cellId]!,
          this.cellMinY[cellId]!,
          this.cellMaxX[cellId]!,
          this.cellMaxY[cellId]!,
        )
      ) {
        return
      }
      for (let z = 0; z < this.layers; z++) {
        const flatIdx = z * this.planeSize + cellId
        if (
          cellId !== sourceCellId &&
          this.shouldSkipFixedPortHalo(flatIdx, connId)
        ) {
          continue
        }
        this.fillTraceOccupants(flatIdx, connId, this._cellOccs)
        if (this._cellOccs.length > 0) {
          for (let i = 0; i < this._cellOccs.length; i++) {
            pushUnique(displacedByVias, this._cellOccs[i]!)
          }
          this.replaceOccupants(flatIdx, connId)
          indices.push(flatIdx)
          continue
        }
        const existing = this.usedCellsFlat[flatIdx]!
        if (existing !== -1 && existing !== connId) {
          this.addSharedOccupant(flatIdx, connId)
        } else {
          this.usedCellsFlat[flatIdx] = connId
        }
        indices.push(flatIdx)
      }
    })
  }

  private forEachCellNearCircle(
    cx: number,
    cy: number,
    radius: number,
    visitor: (cellId: number) => void,
  ) {
    const minFineCol = clamp(
      Math.floor((cx - radius - this.boundsMinX) / this.highResolutionCellSize),
      0,
      this.fineCols - 1,
    )
    const maxFineCol = clamp(
      Math.floor((cx + radius - this.boundsMinX) / this.highResolutionCellSize),
      0,
      this.fineCols - 1,
    )
    const minFineRow = clamp(
      Math.floor((cy - radius - this.boundsMinY) / this.highResolutionCellSize),
      0,
      this.fineRows - 1,
    )
    const maxFineRow = clamp(
      Math.floor((cy + radius - this.boundsMinY) / this.highResolutionCellSize),
      0,
      this.fineRows - 1,
    )

    for (let regionIdx = 0; regionIdx < this.regions.length; regionIdx++) {
      const region = this.regions[regionIdx]!
      if (region.rows === 0 || region.cols === 0) continue

      const regionFineRowMin = Math.max(minFineRow, region.fineOriginRow)
      const regionFineRowMax = Math.min(
        maxFineRow,
        region.fineOriginRow + region.fineRows - 1,
      )
      const regionFineColMin = Math.max(minFineCol, region.fineOriginCol)
      const regionFineColMax = Math.min(
        maxFineCol,
        region.fineOriginCol + region.fineCols - 1,
      )
      if (regionFineRowMin > regionFineRowMax) continue
      if (regionFineColMin > regionFineColMax) continue

      const localRowMin = Math.floor(
        (regionFineRowMin - region.fineOriginRow) / region.cellScale,
      )
      const localRowMax = Math.floor(
        (regionFineRowMax - region.fineOriginRow) / region.cellScale,
      )
      const localColMin = Math.floor(
        (regionFineColMin - region.fineOriginCol) / region.cellScale,
      )
      const localColMax = Math.floor(
        (regionFineColMax - region.fineOriginCol) / region.cellScale,
      )

      for (let row = localRowMin; row <= localRowMax; row++) {
        for (let col = localColMin; col <= localColMax; col++) {
          visitor(this.cellIdFor(region.id, row, col))
        }
      }
    }
  }

  private ripTrace(connId: ConnId): void {
    while (this.ripCount.length <= connId) this.ripCount.push(0)
    this.ripCount[connId]!++
    this.totalRipEvents++
    if (this.totalRipEvents >= this.MAX_RIPS) {
      this.error = `Convergence failure: exceeded MAX_RIPS ${this.MAX_RIPS}`
      this.failed = true
      return
    }

    const routes = this.getSolvedRoutesForConn(connId)
    if (routes.length > 0) {
      for (const route of routes) {
        for (let i = 0; i < route.states.length; i++) {
          const state = route.states[i]!
          const cellId = state % this.planeSize
          this.penalty2d[cellId] =
            this.penalty2d[cellId]! + this.hyperParameters.ripTracePenalty
        }
        for (let i = 0; i < route.viaCellIds.length; i++) {
          const cellId = route.viaCellIds[i]!
          this.penalty2d[cellId] =
            this.penalty2d[cellId]! + this.hyperParameters.ripViaPenalty
        }
      }
    }

    const indices = this.usedIndicesByConn[connId]
    if (indices) {
      for (let i = 0; i < indices.length; i++) {
        this.removeOccupant(indices[i]!, connId)
      }
      this.usedIndicesByConn[connId] = undefined
    }

    if (routes.length > 0) {
      this.solvedRoutes[connId] = undefined
      for (const route of routes) {
        const first = route.states[0]!
        const last = route.states[route.states.length - 1]!
        const startZ = Math.floor(first / this.planeSize)
        const endZ = Math.floor(last / this.planeSize)
        this.unsolvedSegs.push({
          connId,
          startZ,
          startCellId: first - startZ * this.planeSize,
          startPoint: route.startPoint,
          endZ,
          endCellId: last - endZ * this.planeSize,
          endPoint: route.endPoint,
        })
      }
    }
  }

  private flattenNeighborLists(neighbors: NeighborEdge[][]) {
    const offset = new Int32Array(neighbors.length + 1)
    let total = 0
    for (let i = 0; i < neighbors.length; i++) {
      offset[i] = total
      total += neighbors[i]!.length
    }
    offset[neighbors.length] = total

    const ids = new Int32Array(total)
    const costs = new Float32Array(total)
    let cursor = 0
    for (let i = 0; i < neighbors.length; i++) {
      const edges = neighbors[i]!
      for (let j = 0; j < edges.length; j++) {
        const edge = edges[j]!
        ids[cursor] = edge.cellId
        costs[cursor] = edge.cost
        cursor++
      }
    }

    return { offset, ids, costs }
  }

  override visualize() {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]
    const vt = this.gridToBoundsTransform

    const points: Array<{
      x: number
      y: number
      color?: string
      label?: string
    }> = []
    const lines: Array<{
      points: Array<{ x: number; y: number }>
      strokeColor?: string
      strokeWidth?: number
    }> = []
    const circles: Array<{
      center: { x: number; y: number }
      radius: number
      fill?: string
      stroke?: string
    }> = []
    const rects: Array<{
      center: { x: number; y: number }
      width: number
      height: number
      fill?: string
      stroke?: string
    }> = []

    rects.push({
      center: {
        x: this.nodeWithPortPoints.center.x,
        y: this.nodeWithPortPoints.center.y,
      },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      stroke: "gray",
    })

    if (this.showPenaltyMap && this.penalty2d) {
      let maxPenalty = 0
      for (let i = 0; i < this.penalty2d.length; i++) {
        if (this.penalty2d[i]! > maxPenalty) maxPenalty = this.penalty2d[i]!
      }
      if (maxPenalty > 0) {
        for (let cellId = 0; cellId < this.planeSize; cellId++) {
          const penalty = this.penalty2d[cellId]!
          if (penalty <= 0) continue
          const tc = applyAffineTransformToPoint(vt, {
            x: this.cellCenterX[cellId]!,
            y: this.cellCenterY[cellId]!,
          })
          const alpha = Math.min(0.6, (penalty / maxPenalty) * 0.6)
          rects.push({
            center: tc,
            width: this.cellWidth[cellId]! * vt.a,
            height: this.cellHeight[cellId]! * vt.e,
            fill: `rgba(255,165,0,${alpha.toFixed(3)})`,
          })
        }
      }
    }

    if (this.showUsedCellMap && this.usedCellsFlat) {
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let cellId = 0; cellId < this.planeSize; cellId++) {
          const occ = this.usedCellsFlat[zBase + cellId]!
          if (occ === -1) continue
          const tc = applyAffineTransformToPoint(vt, {
            x: this.cellCenterX[cellId]!,
            y: this.cellCenterY[cellId]!,
          })
          rects.push({
            center: tc,
            width: this.cellWidth[cellId]! * vt.a,
            height: this.cellHeight[cellId]! * vt.e,
            fill: "rgba(0,0,255,0.5)",
          })
        }
      }
    }

    for (const pp of this.nodeWithPortPoints.portPoints) {
      points.push({
        x: pp.x,
        y: pp.y,
        color: LAYER_COLORS[pp.z] ?? "gray",
        label: pp.connectionName,
      })
    }

    const TRACE_COLORS = [
      "rgba(255,0,0,0.75)",
      "rgba(0,0,255,0.75)",
      "rgba(255,165,0,0.75)",
      "rgba(0,128,0,0.75)",
    ]
    const transformedRoutes = this.getOutput()
    for (const route of transformedRoutes) {
      if (route.route.length < 2) continue

      let segStart = 0
      for (let i = 1; i < route.route.length; i++) {
        const prev = route.route[i - 1]!
        const curr = route.route[i]!
        if (curr.z !== prev.z) {
          if (i - segStart >= 2) {
            lines.push({
              points: route.route
                .slice(segStart, i)
                .map((p) => ({ x: p.x, y: p.y })),
              strokeColor: TRACE_COLORS[prev.z] ?? "rgba(128,128,128,0.75)",
              strokeWidth: this.traceThickness,
            })
          }
          segStart = i
        }
      }
      if (route.route.length - segStart >= 2) {
        const lastZ = route.route[segStart]!.z
        lines.push({
          points: route.route.slice(segStart).map((p) => ({ x: p.x, y: p.y })),
          strokeColor: TRACE_COLORS[lastZ] ?? "rgba(128,128,128,0.75)",
          strokeWidth: this.traceThickness,
        })
      }
    }

    for (const route of transformedRoutes) {
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: this.viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }

    if (this.activeConnSeg && this.visitedFlatStamp) {
      const currentStamp = this.stamp
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let cellId = 0; cellId < this.planeSize; cellId++) {
          if (this.visitedFlatStamp[zBase + cellId] !== currentStamp) continue
          const tc = applyAffineTransformToPoint(vt, {
            x: this.cellCenterX[cellId]!,
            y: this.cellCenterY[cellId]!,
          })
          points.push({
            x: tc.x,
            y: tc.y,
            color: "rgba(0,0,255,0.2)",
          })
        }
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `${this.getSolverName()} [${this.getSolvedRouteCount()} solved, ${this.unsolvedSegs?.length ?? 0} remaining]`,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const t = this.gridToBoundsTransform
    const result: HighDensityIntraNodeRoute[] = []

    for (let connId = 0; connId < this.solvedRoutes.length; connId++) {
      const routes = this.getSolvedRoutesForConn(connId)
      if (routes.length === 0) continue
      const connName = this.connIdToName[connId]!
      for (const route of routes) {
        const points = Array.from(route.states, (state) => {
          const z = Math.floor(state / this.planeSize)
          const cellId = state - z * this.planeSize
          const tp = applyAffineTransformToPoint(t, {
            x: this.cellCenterX[cellId]!,
            y: this.cellCenterY[cellId]!,
          })
          return {
            x: tp.x,
            y: tp.y,
            z: this.layerToZ.get(z) ?? z,
          }
        })
        if (points.length === 1) {
          points[0] = { ...route.startPoint }
          points.push({ ...route.endPoint })
        } else if (points.length > 1) {
          points[0] = { ...route.startPoint }
          points[points.length - 1] = { ...route.endPoint }
        }
        result.push({
          connectionName: connName,
          rootConnectionName: this.connIdToRootNet[connId],
          regionId: this.nodeWithPortPoints.capacityMeshNodeId,
          traceThickness: this.traceThickness,
          viaDiameter: this.viaDiameter,
          route: points,
          vias: Array.from(route.viaCellIds, (cellId) =>
            applyAffineTransformToPoint(t, {
              x: this.cellCenterX[cellId]!,
              y: this.cellCenterY[cellId]!,
            }),
          ),
        })
      }
    }

    return result
  }

  private getSolvedRoutesForConn(connId: ConnId): SolvedRouteInternal[] {
    const routes = this.solvedRoutes[connId] as
      | SolvedRouteInternal[]
      | SolvedRouteInternal
      | undefined
    if (!routes) return []
    return Array.isArray(routes) ? routes : [routes]
  }

  private getSolvedRouteCount() {
    let count = 0
    for (let i = 0; i < this.solvedRoutes.length; i++) {
      count += this.getSolvedRoutesForConn(i).length
    }
    return count
  }

  private computeGridToBoundsTransform(): AffineTransform {
    let minCenterX = Infinity
    let maxCenterX = -Infinity
    let minCenterY = Infinity
    let maxCenterY = -Infinity

    for (let cellId = 0; cellId < this.planeSize; cellId++) {
      const centerX = this.cellCenterX[cellId]!
      const centerY = this.cellCenterY[cellId]!
      if (centerX < minCenterX) minCenterX = centerX
      if (centerX > maxCenterX) maxCenterX = centerX
      if (centerY < minCenterY) minCenterY = centerY
      if (centerY > maxCenterY) maxCenterY = centerY
    }

    const xSpan = maxCenterX - minCenterX
    const ySpan = maxCenterY - minCenterY
    const width = this.boundsMaxX - this.boundsMinX
    const height = this.boundsMaxY - this.boundsMinY

    const a = xSpan > 0 ? width / xSpan : 1
    const e = ySpan > 0 ? height / ySpan : 1
    const c =
      xSpan > 0
        ? this.boundsMinX - a * minCenterX
        : (this.boundsMinX + this.boundsMaxX) / 2 - minCenterX
    const f =
      ySpan > 0
        ? this.boundsMinY - e * minCenterY
        : (this.boundsMinY + this.boundsMaxY) / 2 - minCenterY

    return { a, b: 0, c, d: 0, e, f }
  }
}

export { WorkerHighDensityA03Solver as HighDensityA03Solver }
