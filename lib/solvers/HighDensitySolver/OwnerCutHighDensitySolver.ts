/*
 * Owned experimental kernel adapted from @tscircuit/high-density-a01 0.0.36
 * (10cdce5ad). Native occupancy/rip rules remain frozen within each query.
 *
 * MIT License
 * 
 * Copyright (c) 2026 tscircuit
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { isOwnerCutNodeEligible } from "./isOwnerCutNodeEligible"
import { createOwnerCutFixedCopperOracle } from "./createOwnerCutFixedCopperOracle"
import { findOwnerCutPath, type OwnerCutHop } from "./findOwnerCutPath"
import { validateOwnerCutRoutes, type OwnerCutValidationContext } from "./validateOwnerCutRoutes"
import { BaseSolver } from "@tscircuit/solver-utils"
import { getConnectionPortPointPairs } from "./ownerCutKernel/getConnectionPortPointPairs"
import {
  type AffineTransform,
  applyAffineTransformToPoint,
  computeGridToAffineTransform,
} from "@tscircuit/high-density-a01"
import { computeMaxIterationsByNodeSizeAndConnectionCount } from "./ownerCutKernel/maxIterationsByNodeSizeAndConnectionCount"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "@tscircuit/high-density-a01"

// --- Interned connection ID ---
type ConnId = number
type GridCellIndex = number

// --- Persistent ripped-trace linked list ---
interface RippedNode {
  id: ConnId
  prev: RippedNode | null
}

function rippedContains(r: RippedNode | null, id: ConnId): boolean {
  for (let cur = r; cur; cur = cur.prev) if (cur.id === id) return true
  return false
}

// --- A* search node (stored in a pool) ---
interface SearchNode {
  z: number
  row: number
  col: number
  g: number
  parentIdx: number // -1 = root
  ripped: RippedNode | null
}

// --- Connection segment ---
interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startRow: number
  startCol: number
  startPoint: { x: number; y: number; z: number }
  endZ: number
  endRow: number
  endCol: number
  endPoint: { x: number; y: number; z: number }
}

// --- Internal solved route (cell-based) ---
interface SolvedRouteInternal {
  connId: ConnId
  startZ: number
  startRow: number
  startCol: number
  startPoint: { x: number; y: number; z: number }
  endZ: number
  endRow: number
  endCol: number
  endPoint: { x: number; y: number; z: number }
  cells: Array<{ z: number; row: number; col: number }>
  viaCells: Array<{ row: number; col: number }>
}

interface CircularGridOffsets {
  rowOffsets: Int32Array
  columnOffsets: Int32Array
  length: number
}

function createCircularGridOffsets(params: {
  radiusMm: number
  cellSizeMm: number
}): CircularGridOffsets {
  const radiusCellRatio = params.radiusMm / params.cellSizeMm
  const nearestRadiusCellCount = Math.round(radiusCellRatio)
  const radiusCells =
    Math.abs(radiusCellRatio - nearestRadiusCellCount) <= 1e-9
      ? nearestRadiusCellCount
      : Math.ceil(radiusCellRatio)
  const radiusCellsSquared = radiusCells * radiusCells
  const rowOffsets: number[] = []
  const columnOffsets: number[] = []

  for (let rowOffset = -radiusCells; rowOffset <= radiusCells; rowOffset++) {
    for (
      let columnOffset = -radiusCells;
      columnOffset <= radiusCells;
      columnOffset++
    ) {
      if (
        rowOffset * rowOffset + columnOffset * columnOffset <=
        radiusCellsSquared
      ) {
        rowOffsets.push(rowOffset)
        columnOffsets.push(columnOffset)
      }
    }
  }

  return {
    rowOffsets: new Int32Array(rowOffsets),
    columnOffsets: new Int32Array(columnOffsets),
    length: rowOffsets.length,
  }
}

// --- Min-heap for A* open set ---
class MinHeap {
  private f: number[] = []
  private seq: number[] = []
  private id: number[] = []
  private n = 0

  push(f: number, seq: number, id: number) {
    let i = this.n++
    while (i > 0) {
      const p = (i - 1) >> 1
      const parentF = this.f[p]!
      const parentSeq = this.seq[p]!
      if (parentF !== f ? parentF < f : parentSeq < seq) break
      this.f[i] = parentF
      this.seq[i] = parentSeq
      this.id[i] = this.id[p]!
      i = p
    }
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
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

  private siftDown(i: number) {
    const f = this.f[i]!
    const seq = this.seq[i]!
    const id = this.id[i]!
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) break
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      const childF = this.f[m]!
      if (f !== childF ? f < childF : seq < this.seq[m]!) break
      this.f[i] = childF
      this.seq[i] = this.seq[m]!
      this.id[i] = this.id[m]!
      i = m
    }
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }
}

// --- Types ---
interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

function toRootNetName(
  connectionName: string,
  rootConnectionName?: string,
): string {
  return rootConnectionName ?? connectionName.replace(/_mst\d+$/, "")
}

export interface OwnerCutHighDensitySolverProps extends OwnerCutValidationContext {
  ownerCutDiagnostics?: Record<string, number>
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier?: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  effort?: number
  hyperParameters?: Partial<HyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    row: number
    col: number
  }) => number
}

// Static direction offsets for 8-connected neighbor expansion
const DIRS_DR = [-1, -1, -1, 0, 0, 1, 1, 1] as const
const DIRS_DC = [-1, 0, 1, -1, 1, -1, 0, 1] as const

export class OwnerCutHighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "OwnerCutHighDensitySolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  MAX_RIPS: number
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  effort: number
  stepMultiplier: number
  hyperParameters: HyperParameters
  initialPenaltyFn?: OwnerCutHighDensitySolverProps["initialPenaltyFn"]
  protected useExactViaTraceClearance = true
  protected ripHistoryCostMultiplier = 0

  // Grid dimensions
  rows!: number
  cols!: number
  layers!: number
  gridOrigin!: { x: number; y: number }
  gridToBoundsTransform!: AffineTransform

  // Z-layer mapping
  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>

  // --- Interned connections ---
  private connNameToId!: Map<string, ConnId>
  private connIdToName!: string[]
  private connIdToRootNet!: string[]
  private overlapFriendlyRootNets!: Set<string>

  // --- Flat arrays ---
  private planeSize!: number // rows * cols
  private usedCellsFlat!: Int32Array // layers * planeSize; -1 = empty
  private portOwnerFlat!: Int32Array // layers * planeSize; -1 = none, -2 = shared
  private usedDiagFlat!: Int32Array // layers * (rows-1) * (cols-1) * 2; -1 = empty
  private penalty2d!: Float64Array // planeSize
  private visitedStamp!: Uint32Array // layers * planeSize
  private sharedCrossRootPortCells!: Set<number>
  private stamp = 0

  // --- Precomputed via footprint offsets ---
  private viaOccupantScanOffsetsDr!: Int32Array
  private viaOccupantScanOffsetsDc!: Int32Array
  private viaOccupantScanOffsetsLen!: number
  private viaOwnersByCell!: Map<number, Set<ConnId>>
  private viaCenterIndicesByConn!: number[][]
  private viaTraceClearanceMm!: number
  private outputCellStepX!: number
  private outputCellStepY!: number

  // --- Via zone boundaries (cell coordinates) ---
  private minViaRow!: number
  private maxViaRow!: number
  private minViaCol!: number
  private maxViaCol!: number

  // --- Per-connection used-cell tracking ---
  private usedIndicesByConn!: number[][] // connId -> [flatCellIdx, ...]
  private usedDiagIndicesByConn!: number[][] // connId -> [flatDiagIdx, ...]

  // --- Connection queues ---
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Map<ConnId, SolvedRouteInternal[]>

  // --- A* state ---
  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private crossLayerSearch = false
  private nodePool!: SearchNode[]
  private heap!: MinHeap
  private seqCounter = 0

  // --- Reusable scratch for via occupant scan ---
  private _viaOccs: ConnId[] = []
  private viaOccupantsByCell = new Map<GridCellIndex, readonly ConnId[]>()

  // --- Convergence state ---
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number
  private baseSearchBudgetIters!: number

  // --- Reusable scratch for computeMoveCostAndRips ---
  private _moveCost = 0
  private _moveRipped: RippedNode | null = null
  private ownerCutAllowedRipOwners: Set<number> | null = null

  // --- Test/debug compatibility getters ---
  get unsolvedConnections() {
    return this.unsolvedSegs
  }
  get solvedConnectionsMap() {
    return this.solvedRoutes
  }
  get activeConnection() {
    if (!this.activeConnSeg) return null
    const s = this.activeConnSeg
    return {
      connectionName: this.connIdToName[s.connId] ?? "",
      start: { row: s.startRow, col: s.startCol, z: s.startZ, x: 0, y: 0 },
      end: { row: s.endRow, col: s.endCol, z: s.endZ, x: 0, y: 0 },
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
    }
  }

  constructor(readonly ownerCutParams: OwnerCutHighDensitySolverProps) {
    const props = ownerCutParams
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm
    this.viaDiameter = props.viaDiameter
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.effort = props.effort ?? 1
    this.stepMultiplier = Math.max(1, Math.floor(props.stepMultiplier ?? 1))
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 10,
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

  override getConstructorParams(): [OwnerCutHighDensitySolverProps] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        cellSizeMm: this.cellSizeMm,
        viaDiameter: this.viaDiameter,
        maxCellCount: this.maxCellCount,
        stepMultiplier: this.stepMultiplier,
        traceThickness: this.traceThickness,
        traceMargin: this.traceMargin,
        viaMinDistFromBorder: this.viaMinDistFromBorder,
        showPenaltyMap: this.showPenaltyMap,
        showUsedCellMap: this.showUsedCellMap,
        effort: this.effort,
        hyperParameters: this.hyperParameters,
        initialPenaltyFn: this.initialPenaltyFn,
        ...this.ownerCutParams,
      },
    ]
  }

  override _setup(): void {
    if (this.cellSizeMm !== 0.1 || !isOwnerCutNodeEligible(this.ownerCutParams)) {
      this.failed = true
      this.error = "Owner-cut candidate outside its bounded physical-layer domain"
      return
    }
    const { nodeWithPortPoints, cellSizeMm } = this
    const { width, height, center } = nodeWithPortPoints

    // Z layers
    this.availableZ =
      nodeWithPortPoints.availableZ ??
      [...new Set(nodeWithPortPoints.portPoints.map((pp) => pp.z))].sort(
        (a, b) => a - b,
      )

    this.rows = Math.floor(height / cellSizeMm)
    this.cols = Math.floor(width / cellSizeMm)
    this.layers = this.availableZ.length
    this.planeSize = this.rows * this.cols
    const totalCells = this.layers * this.planeSize
    if (this.maxCellCount !== undefined && totalCells > this.maxCellCount) {
      this.error = `Cell count ${totalCells} exceeds maxCellCount ${this.maxCellCount}`
      this.failed = true
      return
    }
    const totalDiags =
      this.layers * Math.max(0, this.rows - 1) * Math.max(0, this.cols - 1) * 2

    this.zToLayer = new Map()
    this.layerToZ = new Map()
    for (let i = 0; i < this.availableZ.length; i++) {
      const z = this.availableZ[i]!
      this.zToLayer.set(z, i)
      this.layerToZ.set(i, z)
    }

    this.gridOrigin = {
      x: center.x - width / 2,
      y: center.y - height / 2,
    }
    this.gridToBoundsTransform = computeGridToAffineTransform({
      originX: this.gridOrigin.x,
      originY: this.gridOrigin.y,
      rows: this.rows,
      cols: this.cols,
      cellSizeMm,
      width,
      height,
    })
    this.outputCellStepX = this.cols > 1 ? width / (this.cols - 1) : width
    this.outputCellStepY = this.rows > 1 ? height / (this.rows - 1) : height

    // Intern connections
    this.connNameToId = new Map()
    this.connIdToName = []
    this.connIdToRootNet = []
    this.overlapFriendlyRootNets = new Set()

    // Flat penalty map (Float64Array is zero-initialized)
    this.penalty2d = new Float64Array(this.planeSize)
    if (this.initialPenaltyFn) {
      for (let row = 0; row < this.rows; row++) {
        const rowBase = row * this.cols
        for (let col = 0; col < this.cols; col++) {
          const x = this.gridOrigin.x + (col + 0.5) * cellSizeMm
          const y = this.gridOrigin.y + (row + 0.5) * cellSizeMm
          const px = (col + 0.5) / this.cols
          const py = (row + 0.5) / this.rows
          this.penalty2d[rowBase + col] = this.initialPenaltyFn({
            x,
            y,
            px,
            py,
            row,
            col,
          })
        }
      }
    }

    // Flat used cells (Int32Array, -1 = empty)
    this.usedCellsFlat = new Int32Array(totalCells).fill(-1)
    this.portOwnerFlat = new Int32Array(totalCells).fill(-1)
    this.usedDiagFlat = new Int32Array(totalDiags).fill(-1)

    // Visited stamp array (Uint32Array is zero-initialized)
    this.visitedStamp = new Uint32Array(totalCells)
    this.stamp = 0

    // Existing traces already occupy their traceMargin halo, so a prospective
    // via only needs to scan its own copper radius around that occupancy.
    const viaOccupantScanOffsets = createCircularGridOffsets({
      radiusMm: this.viaDiameter / 2,
      cellSizeMm,
    })
    this.viaOccupantScanOffsetsLen = viaOccupantScanOffsets.length
    this.viaOccupantScanOffsetsDr = viaOccupantScanOffsets.rowOffsets
    this.viaOccupantScanOffsetsDc = viaOccupantScanOffsets.columnOffsets
    this.viaOwnersByCell = new Map()
    this.viaCenterIndicesByConn = []
    this.viaTraceClearanceMm = this.viaDiameter / 2 + this.traceThickness / 2

    // Precompute via zone boundaries
    if (this.viaMinDistFromBorder > 0) {
      const borderCells = Math.ceil(this.viaMinDistFromBorder / cellSizeMm)
      this.minViaRow = borderCells
      this.maxViaRow = this.rows - 1 - borderCells
      this.minViaCol = borderCells
      this.maxViaCol = this.cols - 1 - borderCells
    } else {
      this.minViaRow = 0
      this.maxViaRow = this.rows - 1
      this.minViaCol = 0
      this.maxViaCol = this.cols - 1
    }

    // Build and shuffle connections
    this.unsolvedSegs = this.buildConnectionSegs()

    this.sharedCrossRootPortCells = new Set()
    const rootByPortFlat = new Map<number, string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const connId = this.connNameToId.get(pp.connectionName)
      if (connId === undefined) continue
      const cell = this.pointToCell(pp)
      const flatIdx = (cell.z * this.rows + cell.row) * this.cols + cell.col
      const rootNet = this.connIdToRootNet[connId]!
      const existingRoot = rootByPortFlat.get(flatIdx)
      if (existingRoot === undefined) {
        rootByPortFlat.set(flatIdx, rootNet)
      } else if (existingRoot !== rootNet) {
        this.sharedCrossRootPortCells.add(flatIdx)
      }
      const existing = this.portOwnerFlat[flatIdx]!
      if (existing === -1 || existing === connId) {
        this.portOwnerFlat[flatIdx] = connId
      } else {
        this.portOwnerFlat[flatIdx] = -2
      }
    }
    this.solvedRoutes = new Map()
    this.usedIndicesByConn = []
    this.usedDiagIndicesByConn = []
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

    const setupWork = totalCells * 12 + totalDiags * 2 +
      this.nodeWithPortPoints.portPoints.length ** 2
    this.iterations += setupWork
    if (this.ownerCutParams.ownerCutDiagnostics)
      this.ownerCutParams.ownerCutDiagnostics.ownerCutSetupWork =
        (this.ownerCutParams.ownerCutDiagnostics.ownerCutSetupWork ?? 0) + setupWork

    // A* state
    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = []
    this.heap = new MinHeap()
    this.seqCounter = 0
  }

  override _step(): void {
    for (let i = 0; i < this.stepMultiplier; i++) {
      if (this.solved || this.failed) return
      this.stepOnce()
      if (this.solved) this.acceptPhysicalOutput()
    }
  }

  private stepOnce(): void {
    // 1. If no active connection, dequeue next
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        this.solved = true
        return
      }
      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId
      this.crossLayerSearch = next.startZ !== next.endZ

      // Occupancy and the active net stay fixed until this search finishes.
      // Clear before another connection observes newly routed or ripped copper.
      this.viaOccupantsByCell.clear()

      // Reset A* state for this connection
      this.nodePool = []
      this.heap.clear()
      this.seqCounter = 0
      this.searchIterations = 0
      this.nextStamp()

      // Push start node
      const h = this.computeH(
        next.startZ,
        next.startRow,
        next.startCol,
        next.endZ,
        next.endRow,
        next.endCol,
      )
      const f = h * this.hyperParameters.greedyMultiplier
      this.nodePool.push({
        z: next.startZ,
        row: next.startRow,
        col: next.startCol,
        g: 0,
        parentIdx: -1,
        ripped: null,
      })
      this.heap.push(f, this.seqCounter++, 0)
      return
    }

    // The graph is frozen until this query commits. Permissions remove only
    // mutable route owners; ports and opposite diagonal rules stay immutable.
    const seg = this.activeConnSeg
    const encode = (z: number, row: number, col: number): number =>
      (z * this.rows + row) * this.cols + col
    const routePoints = [...this.solvedRoutes.values()].reduce((sum, routes) =>
      sum + routes.reduce((count, route) => count + route.cells.length, 0), 0)
    const preparationWork = 32 + routePoints * 4 +
      this.nodeWithPortPoints.portPoints.length ** 2 +
      this.ownerCutParams.obstacles.reduce((sum, obstacle) =>
        sum + 16 + 8 * obstacle.connectedTo.length, 0)
    if (routePoints > 8192 || preparationWork > this.MAX_ITERATIONS - this.iterations) {
      this.failed = true
      this.error = "Owner-cut UNKNOWN: frozen geometry preparation budget exhausted"
      return
    }
    this.iterations += preparationWork
    const preparationDiagnostics = this.ownerCutParams.ownerCutDiagnostics
    if (preparationDiagnostics) preparationDiagnostics.ownerCutPreparationWork =
      (preparationDiagnostics.ownerCutPreparationWork ?? 0) + preparationWork
    const blocksFixedCopper = createOwnerCutFixedCopperOracle({
      ...this.ownerCutParams, traceThickness: this.traceThickness,
      traceMargin: this.traceMargin, viaDiameter: this.viaDiameter,
    })
    const occupiedRoutes = this.getOutput().filter((route) => {
      const owner = this.connNameToId.get(route.connectionName)
      if (owner === undefined) throw new Error("Owner-cut output lost owner identity")
      const root = this.connIdToRootNet[owner]!
      return owner !== this.activeConnId && !(root ===
        this.connIdToRootNet[this.activeConnId] && this.overlapFriendlyRootNets.has(root))
    })
    const outputPoint = (state: number): { x: number; y: number; z: number } => {
      if (state === encode(seg.startZ, seg.startRow, seg.startCol)) return seg.startPoint
      if (state === encode(seg.endZ, seg.endRow, seg.endCol)) return seg.endPoint
      const z = Math.floor(state / this.planeSize)
      const row = Math.floor((state % this.planeSize) / this.cols)
      const col = state % this.cols
      return { ...applyAffineTransformToPoint(this.gridToBoundsTransform, {
        x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
        y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
      }), z: this.layerToZ.get(z)! }
    }
    const result = findOwnerCutPath({
      start: encode(seg.startZ, seg.startRow, seg.startCol),
      goal: encode(seg.endZ, seg.endRow, seg.endCol),
      stateCount: this.layers * this.planeSize,
      maxWorkUnits: Math.max(0, Math.min(
        this.baseSearchBudgetIters * 16,
        this.MAX_ITERATIONS - this.iterations - 1,
      )),
      getConsistentLowerBound: (state): number => {
        const z = Math.floor(state / this.planeSize)
        const row = Math.floor((state % this.planeSize) / this.cols)
        const col = state % this.cols
        // Euclidean planar distance plus one mandatory layer transition is
        // consistent with every nonnegative residual planar/via edge.
        return Math.hypot(row - seg.endRow, col - seg.endCol) * this.cellSizeMm +
          (z === seg.endZ ? 0 : this.hyperParameters.viaBaseCost)
      },
      getOwnerPrice: (owner): number => this.getRipCost(owner),
      getHops: (state, charge): OwnerCutHop[] | undefined => {
        const z = Math.floor(state / this.planeSize)
        const row = Math.floor((state % this.planeSize) / this.cols)
        const col = state % this.cols
        const hops: OwnerCutHop[] = []
        for (let direction = 0; direction < 8 + this.layers; direction++) {
          const via = direction >= 8
          const nz = via ? direction - 8 : z
          const nr = via ? row : row + DIRS_DR[direction]!
          const nc = via ? col : col + DIRS_DC[direction]!
          if (!charge(1)) return undefined
          if (nz === z && via || nr < 0 || nr >= this.rows ||
            nc < 0 || nc >= this.cols) continue
          if (via && (row < this.minViaRow || row > this.maxViaRow ||
            col < this.minViaCol || col > this.maxViaCol)) continue
          // Conservatively account kernel scans and unique-owner list checks,
          // including all physical layers of every allowed through via.
          const kernelWork = 24 + (via
            ? this.layers * this.viaOccupantScanOffsetsLen *
              (3 + this.connIdToName.length)
            : this.viaOwnersByCell.size * (16 + this.connIdToName.length))
          if (!charge(kernelWork)) return undefined
          this.computeMoveCostAndRips(
            this.activeConnId, z, row, col, nz, nr, nc, null,
          )
          if (this._moveCost < 0) continue
          const owners: number[] = []
          let activationFee = 0
          for (let cursor = this._moveRipped; cursor; cursor = cursor.prev) {
            owners.push(cursor.id)
            activationFee += this.getRipCost(cursor.id)
          }
          let distance = this._moveCost - activationFee
          // Raster occupancy can miss a segment clipping a via or two diagonal
          // copper capsules. Exact continuous geometry contributes additional
          // mutable owner permissions; it cannot relax native hard rules.
          const target = encode(nz, nr, nc)
          const start = outputPoint(state), end = outputPoint(target)
          // Exact connector coordinates replace endpoint cell centres. A layer
          // change at a shifted connector cannot become a diagonal "via".
          if (via && Math.hypot(start.x - end.x, start.y - end.y) > 1e-9) continue
          const move = {
            connectionName: this.connIdToName[this.activeConnId]!,
            traceThickness: this.traceThickness, viaDiameter: this.viaDiameter,
            route: [start, end], vias: via ? [{ x: start.x, y: start.y }] : [],
          }
          const fixedBlocked = blocksFixedCopper(move, charge)
          if (fixedBlocked === undefined) return undefined
          if (fixedBlocked) continue
          for (const route of occupiedRoutes) {
            if (!charge(4 + 2 * (route.route.length + route.vias.length))) return undefined
            if (!doPipeline9RoutesHaveCopperConflict({ left: move, right: route,
              clearance: this.traceMargin, layerCount: 2,
              allowBlindAndBuriedVias: false })) continue
            const owner = this.connNameToId.get(route.connectionName)!
            if (!owners.includes(owner)) {
              owners.push(owner)
              distance += via ? this.hyperParameters.ripViaPenalty :
                this.hyperParameters.ripTracePenalty
            }
          }
          if (distance < -1e-8) throw new Error("Negative owner-cut residual cost")
          hops.push({ target, owners,
            distance: Math.max(0, distance) })
        }
        return hops
      },
    })
    this.iterations += result.work.units
    const diagnostics = this.ownerCutParams.ownerCutDiagnostics
    if (diagnostics) {
      for (const [key, value] of Object.entries({
        ownerCutQueries: 1, ownerCutWork: result.work.units,
        ownerCutLearnedCuts: result.work.learnedCuts,
        ownerCutMasterAssignments: result.work.masterAssignments,
        ownerCutActivatedOwners: result.owners.length,
        ownerCutFound: Number(result.status === "found"),
        ownerCutUnknown: Number(result.status === "unknown"),
        ownerCutDisconnected: Number(result.status === "no_path"),
      })) diagnostics[key] = (diagnostics[key] ?? 0) + value
    }
    if (result.status !== "found") {
      this.failed = true
      this.error = result.status === "unknown"
        ? "Owner-cut UNKNOWN: charged finite-graph budget or memory bound"
        : "Owner-cut complete frozen-grid disconnection"
      return
    }
    const marginCells = Math.ceil(this.traceMargin / this.cellSizeMm)
    const trackedIndices = this.usedIndicesByConn.reduce((sum, values) => sum + values.length, 0) +
      this.usedDiagIndicesByConn.reduce((sum, values) => sum + values.length, 0)
    const commitWork = result.states.length * (16 +
      4 * (2 * marginCells + 1) ** 2 +
      4 * this.layers * this.viaOccupantScanOffsetsLen) +
      trackedIndices * 8 + this.planeSize * 2 + routePoints * 2
    if (commitWork > this.MAX_ITERATIONS - this.iterations) {
      this.failed = true
      this.error = "Owner-cut UNKNOWN: route commit budget exhausted"
      return
    }
    this.iterations += commitWork
    if (diagnostics) diagnostics.ownerCutCommitWork =
      (diagnostics.ownerCutCommitWork ?? 0) + commitWork
    this.ownerCutAllowedRipOwners = new Set(result.owners)
    // The policy intentionally prioritizes activation fee before additive
    // distance. It does not reproduce native A*'s combined weighted objective.
    this.nodePool = []
    let ripped: RippedNode | null = null
    for (let index = 0; index < result.states.length; index++) {
      const state = result.states[index]!
      for (const owner of result.hops[index - 1]?.owners ?? []) {
        if (!rippedContains(ripped, owner)) ripped = { id: owner, prev: ripped }
      }
      this.nodePool.push({
        z: Math.floor(state / this.planeSize),
        row: Math.floor((state % this.planeSize) / this.cols),
        col: state % this.cols, g: 0, parentIdx: index - 1, ripped,
      })
    }
    this.finalizeRoute(this.nodePool.length - 1)
    this.ownerCutAllowedRipOwners = null
    this.activeConnSeg = null
    this.activeConnId = -1
  }

  private acceptPhysicalOutput(): void {
    const routes = this.getOutput()
    const pointCount = routes.reduce((sum, route) => sum + route.route.length +
      route.vias.length, 0)
    const linearWork = 100 + 8 * this.ownerCutParams.obstacles.length + pointCount * 8
    if (pointCount > 8192 || linearWork > this.MAX_ITERATIONS - this.iterations) {
      this.solved = false
      this.failed = true
      this.error = "Owner-cut UNKNOWN: physical acceptance preparation budget exhausted"
      return
    }
    this.iterations += linearWork
    // DRC is local to the route envelope. Charge the linear whole-board
    // obstacle scan, then the quadratic bound on relevant primitives only.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const route of routes) for (const point of route.route) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
    }
    const clearance = Math.max(this.traceThickness, this.viaDiameter) / 2 +
      Math.max(this.traceMargin, this.ownerCutParams.viaToPadClearance ?? 0, 0.1) + 1e-6
    let relevantObstacleCount = 0
    for (const obstacle of this.ownerCutParams.obstacles) {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      if (obstacle.center.x + radius >= minX - clearance &&
        obstacle.center.x - radius <= maxX + clearance &&
        obstacle.center.y + radius >= minY - clearance &&
        obstacle.center.y - radius <= maxY + clearance) relevantObstacleCount++
    }
    const work = 32 * (pointCount + relevantObstacleCount + 1) ** 2
    if (work > this.MAX_ITERATIONS - this.iterations) {
      this.solved = false
      this.failed = true
      this.error = "Owner-cut UNKNOWN: physical acceptance budget exhausted"
      return
    }
    this.iterations += work
    const violation = validateOwnerCutRoutes(routes, {
      ...this.ownerCutParams, nodeWithPortPoints: this.nodeWithPortPoints,
      traceThickness: this.traceThickness, traceMargin: this.traceMargin,
      viaDiameter: this.viaDiameter,
    })
    const diagnostics = this.ownerCutParams.ownerCutDiagnostics
    if (diagnostics) {
      diagnostics.ownerCutPhysicalChecks =
        (diagnostics.ownerCutPhysicalChecks ?? 0) + 1
      diagnostics.ownerCutPhysicalWork =
        (diagnostics.ownerCutPhysicalWork ?? 0) + work + linearWork
    }
    if (violation) {
      this.solved = false
      this.failed = true
      this.error = `Owner-cut UNKNOWN: physical output rejected: ${violation}`
      if (diagnostics) diagnostics.ownerCutPhysicalRejected =
        (diagnostics.ownerCutPhysicalRejected ?? 0) + 1
    }
  }

  // --- Merged cost + rip computation (writes to _moveCost/_moveRipped) ---
  protected getRipCost(connId: ConnId): number {
    return (
      this.hyperParameters.ripCost *
      (1 + this.ripHistoryCostMultiplier * (this.ripCount[connId] ?? 0))
    )
  }

  private computeMoveCostAndRips(
    activeConn: ConnId,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: RippedNode | null,
  ): void {
    let cost = 0
    let r = ripped
    const cols = this.cols

    if (fromZ !== toZ) {
      // Via transition
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toRow * cols + toCol]!, this.penaltyCap)

      const toFlatIdx = (toZ * this.rows + toRow) * cols + toCol
      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd =
        !!seg &&
        toZ === seg.endZ &&
        toRow === seg.endRow &&
        toCol === seg.endCol
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRipped = r
        return
      }

      // Via footprint occupants (reusable scratch array)
      this.fillViaOccupants(toRow, toCol, activeConn)
      const occs = this._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!rippedContains(r, occ)) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      // Lateral movement
      const dr = fromRow > toRow ? fromRow - toRow : toRow - fromRow
      const dc = fromCol > toCol ? fromCol - toCol : toCol - fromCol
      cost += (dr + dc > 1 ? Math.SQRT2 : 1) * this.cellSizeMm
      cost += Math.min(this.penalty2d[toRow * cols + toCol]!, this.penaltyCap)

      const flatIdx = (toZ * this.rows + toRow) * cols + toCol
      const fixedOwner = this.portOwnerFlat[flatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd =
        !!seg &&
        toZ === seg.endZ &&
        toRow === seg.endRow &&
        toCol === seg.endCol
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRipped = r
        return
      }

      const occ = this.usedCellsFlat[flatIdx]!
      const sameRoot =
        this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
      const allowSameRootOverlap =
        sameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      if (occ !== -1 && occ !== activeConn && !allowSameRootOverlap) {
        if (!rippedContains(r, occ)) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripTracePenalty
      }

      // usedCellsFlat only records occupied grid points. A diagonal segment
      // can pass between those points and clip a via, so check the actual
      // output-space segment against nearby via centers as well.
      if (this.viaOwnersByCell.size > 0) {
        this.fillTraceSegmentViaOccupants(
          fromRow,
          fromCol,
          toRow,
          toCol,
          activeConn,
        )
        const viaOccs = this._viaOccs
        for (let i = 0; i < viaOccs.length; i++) {
          const viaOwner = viaOccs[i]!
          if (!rippedContains(r, viaOwner)) {
            cost += this.getRipCost(viaOwner)
            r = { id: viaOwner, prev: r }
          }
          cost += this.hyperParameters.ripViaPenalty
        }
      }

      // Prevent unmodeled same-layer diagonal X-crossings.
      // If this move uses one diagonal of a grid square, check the opposite
      // diagonal occupancy in that same square and treat it like a rip conflict.
      if (dr === 1 && dc === 1) {
        const sqRow = fromRow < toRow ? fromRow : toRow
        const sqCol = fromCol < toCol ? fromCol : toCol
        const isBackslash =
          (fromRow < toRow && fromCol < toCol) ||
          (fromRow > toRow && fromCol > toCol)
        const diagSlot = isBackslash ? 0 : 1
        const crossingSlot = diagSlot ^ 1
        const sqCols = this.cols - 1
        const diagBase = ((toZ * (this.rows - 1) + sqRow) * sqCols + sqCol) * 2
        const crossingOcc = this.usedDiagFlat[diagBase + crossingSlot]!
        const crossingSameRoot =
          this.connIdToRootNet[crossingOcc] === this.connIdToRootNet[activeConn]
        const allowCrossingOverlap =
          crossingSameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        if (
          crossingOcc !== -1 &&
          crossingOcc !== activeConn &&
          !allowCrossingOverlap
        ) {
          this._moveCost = -1
          this._moveRipped = r
          return
        }
      }
    }

    this._moveCost = cost
    this._moveRipped = r
  }

  // --- Via footprint unique occupants (fills _viaOccs scratch array) ---
  private fillViaOccupants(row: number, col: number, activeConn: ConnId): void {
    const occs = this._viaOccs
    occs.length = 0
    const cellId = row * this.cols + col
    const cachedOccupants = this.viaOccupantsByCell.get(cellId)
    if (cachedOccupants) {
      for (const connId of cachedOccupants) occs.push(connId)
      return
    }
    const rows = this.rows
    const cols = this.cols
    const offDr = this.viaOccupantScanOffsetsDr
    const offDc = this.viaOccupantScanOffsetsDc
    const offLen = this.viaOccupantScanOffsetsLen
    const used = this.usedCellsFlat

    for (let z = 0; z < this.layers; z++) {
      const zBase = z * this.planeSize
      for (let i = 0; i < offLen; i++) {
        const r = row + offDr[i]!
        const c = col + offDc[i]!
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue
        const occ = used[zBase + r * cols + c]!
        if (occ === -1 || occ === activeConn) continue
        const sameRoot =
          this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
        if (
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        ) {
          continue
        }
        // Small unique check (typically very few occupants)
        let seen = false
        for (let j = 0; j < occs.length; j++) {
          if (occs[j] === occ) {
            seen = true
            break
          }
        }
        if (!seen) occs.push(occ)
      }
    }
    // Keep the cached list separate from the mutable scratch array.
    this.viaOccupantsByCell.set(cellId, occs.slice())
  }

  private fillTraceSegmentViaOccupants(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
    activeConn: ConnId,
  ): void {
    const occs = this._viaOccs
    occs.length = 0
    const minRow = Math.min(fromRow, toRow)
    const maxRow = Math.max(fromRow, toRow)
    const minCol = Math.min(fromCol, toCol)
    const maxCol = Math.max(fromCol, toCol)
    const rowClearance = this.viaTraceClearanceMm / this.outputCellStepY
    const colClearance = this.viaTraceClearanceMm / this.outputCellStepX
    const segmentX = (toCol - fromCol) * this.outputCellStepX
    const segmentY = (toRow - fromRow) * this.outputCellStepY
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const clearanceSquared = this.viaTraceClearanceMm * this.viaTraceClearanceMm

    for (const [viaIndex, owners] of this.viaOwnersByCell) {
      const row = Math.floor(viaIndex / this.cols)
      const col = viaIndex - row * this.cols
      if (
        row < minRow - rowClearance ||
        row > maxRow + rowClearance ||
        col < minCol - colClearance ||
        col > maxCol + colClearance
      ) {
        continue
      }

      const viaFromX = (col - fromCol) * this.outputCellStepX
      const viaFromY = (row - fromRow) * this.outputCellStepY
      const projection =
        segmentLengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                (viaFromX * segmentX + viaFromY * segmentY) /
                  segmentLengthSquared,
              ),
            )
      const closestX = segmentX * projection
      const closestY = segmentY * projection
      const distanceX = viaFromX - closestX
      const distanceY = viaFromY - closestY
      if (distanceX * distanceX + distanceY * distanceY >= clearanceSquared) {
        continue
      }

      for (const owner of owners) {
        if (owner === activeConn) continue
        const sameRoot =
          this.connIdToRootNet[owner] === this.connIdToRootNet[activeConn]
        if (
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        ) {
          continue
        }
        if (!occs.includes(owner)) occs.push(owner)
      }
    }
  }

  private shouldSkipFixedPortHalo(flatIdx: number, connId: ConnId) {
    const fixedOwner = this.portOwnerFlat[flatIdx]!
    if (fixedOwner === connId) return false
    if (fixedOwner === -2) return true
    if (fixedOwner < 0) return false
    const sameRoot =
      this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[connId]
    return !(
      sameRoot &&
      this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
    )
  }

  // --- Visited stamp management ---
  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.stamp = 1
    }
  }

  // --- Heuristic: Manhattan + via-zone awareness for cross-layer ---
  private computeH(
    z: number,
    row: number,
    col: number,
    toZ: number,
    toRow: number,
    toCol: number,
  ): number {
    const dr = Math.abs(row - toRow)
    const dc = Math.abs(col - toCol)
    const manhattan = dr + dc

    if (z === toZ) return manhattan * this.cellSizeMm

    // On wrong layer — add viaBaseCost as minimum layer-switch cost
    if (!this.crossLayerSearch) {
      return manhattan * this.cellSizeMm + this.hyperParameters.viaBaseCost
    }

    // Cross-layer search on wrong layer: via-zone-aware estimate.
    // Clamp each endpoint to the via zone to estimate via detour.
    const vr1 = Math.max(this.minViaRow, Math.min(this.maxViaRow, row))
    const vc1 = Math.max(this.minViaCol, Math.min(this.maxViaCol, col))
    const vr2 = Math.max(this.minViaRow, Math.min(this.maxViaRow, toRow))
    const vc2 = Math.max(this.minViaCol, Math.min(this.maxViaCol, toCol))

    const via1 =
      Math.abs(row - vr1) +
      Math.abs(col - vc1) +
      Math.abs(vr1 - toRow) +
      Math.abs(vc1 - toCol)
    const via2 =
      Math.abs(row - vr2) +
      Math.abs(col - vc2) +
      Math.abs(vr2 - toRow) +
      Math.abs(vc2 - toCol)

    return (
      Math.max(Math.min(via1, via2), manhattan) * this.cellSizeMm +
      this.hyperParameters.viaBaseCost
    )
  }

  // --- Connection interning ---
  private internConn(name: string, rootNetName?: string): ConnId {
    const existing = this.connNameToId.get(name)
    if (existing !== undefined) return existing
    const id = this.connIdToName.length
    this.connIdToName.push(name)
    this.connIdToRootNet.push(toRootNetName(name, rootNetName))
    this.connNameToId.set(name, id)
    return id
  }

  // --- Build connection segments from port points ---
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

        const endpointA = `${s.z}:${s.row}:${s.col}`
        const endpointB = `${e.z}:${e.row}:${e.col}`
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
          startRow: s.row,
          startCol: s.col,
          startPoint,
          endZ: e.z,
          endRow: e.row,
          endCol: e.col,
          endPoint,
        })
      }
    }
    return segs
  }

  private pointToCell(pt: { x: number; y: number; z: number }): {
    z: number
    row: number
    col: number
  } {
    const col = Math.max(
      0,
      Math.min(
        this.cols - 1,
        Math.round((pt.x - this.gridOrigin.x) / this.cellSizeMm - 0.5),
      ),
    )
    const row = Math.max(
      0,
      Math.min(
        this.rows - 1,
        Math.round((pt.y - this.gridOrigin.y) / this.cellSizeMm - 0.5),
      ),
    )
    const z = this.zToLayer.get(pt.z) ?? 0
    return { z, row, col }
  }

  private shuffleConnections(): void {
    const arr = this.unsolvedSegs
    let s = this.hyperParameters.shuffleSeed
    const rng = () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff
      return (s >>> 0) / 0xffffffff
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
  }

  // --- Finalize a found route ---
  private finalizeRoute(goalNodeIdx: number): void {
    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)

    // Reconstruct path from parent chain (cell-based)
    const cells: Array<{ z: number; row: number; col: number }> = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const n = this.nodePool[idx]!
      cells.push({ z: n.z, row: n.row, col: n.col })
      idx = n.parentIdx
    }
    cells.reverse()

    while (cells.length > 1) {
      const first = cells[0]!
      const firstFlat =
        (first.z * this.rows + first.row) * this.cols + first.col
      if (!this.sharedCrossRootPortCells.has(firstFlat)) break
      cells.shift()
    }
    while (cells.length > 1) {
      const last = cells[cells.length - 1]!
      const lastFlat = (last.z * this.rows + last.row) * this.cols + last.col
      if (!this.sharedCrossRootPortCells.has(lastFlat)) break
      cells.pop()
    }

    // Detect vias (z-level changes)
    const viaCells: Array<{ row: number; col: number }> = []
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.z !== cells[i - 1]!.z) {
        viaCells.push({ row: cells[i]!.row, col: cells[i]!.col })
      }
    }

    const firstCell = cells[0]!
    const lastCell = cells[cells.length - 1]!

    const connId = this.activeConnId

    // Collect ripped traces from goal node's persistent list
    const goalNode = this.nodePool[goalNodeIdx]!
    const rippedIds: ConnId[] = []
    for (let cur = goalNode.ripped; cur; cur = cur.prev) {
      rippedIds.push(cur.id)
    }

    // Rip displaced traces
    for (let i = 0; i < rippedIds.length; i++) {
      this.ripTrace(rippedIds[i]!)
      if (this.failed) return
    }

    // Mark cells as used (with margin)
    const marginCells = Math.ceil(this.traceMargin / this.cellSizeMm)
    const indices: number[] = []
    const rows = this.rows
    const cols = this.cols
    const used = this.usedCellsFlat

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci]!
      for (let dr = -marginCells; dr <= marginCells; dr++) {
        for (let dc = -marginCells; dc <= marginCells; dc++) {
          const r = cell.row + dr
          const c = cell.col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const flatIdx = (cell.z * rows + r) * cols + c
          if (
            (r !== cell.row || c !== cell.col) &&
            this.shouldSkipFixedPortHalo(flatIdx, connId)
          ) {
            continue
          }
          const existing = used[flatIdx]!
          const sameRoot =
            this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
          const allowSameRootOverlap =
            sameRoot &&
            this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
            continue
          }
          used[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    // Mark via footprint cells
    const displacedByVias: ConnId[] = []
    const offDr = this.viaOccupantScanOffsetsDr
    const offDc = this.viaOccupantScanOffsetsDc
    const offLen = this.viaOccupantScanOffsetsLen

    for (let vi = 0; vi < viaCells.length; vi++) {
      const via = viaCells[vi]!
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let oi = 0; oi < offLen; oi++) {
          const r = via.row + offDr[oi]!
          const c = via.col + offDc[oi]!
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const flatIdx = zBase + r * cols + c
          if (
            (r !== via.row || c !== via.col) &&
            this.shouldSkipFixedPortHalo(flatIdx, connId)
          ) {
            continue
          }
          const existing = used[flatIdx]!
          const sameRoot =
            this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
          const allowSameRootOverlap =
            sameRoot &&
            this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
            // Track displaced (small unique check)
            let seen = false
            for (let k = 0; k < displacedByVias.length; k++) {
              if (displacedByVias[k] === existing) {
                seen = true
                break
              }
            }
            if (!seen) displacedByVias.push(existing)
          }
          used[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    // Mark occupied diagonal edges (for diagonal X-crossing prevention)
    const diagIndices: number[] = []
    const sqCols = this.cols - 1
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1]!
      const curr = cells[i]!
      if (prev.z !== curr.z) continue

      const dr = prev.row > curr.row ? prev.row - curr.row : curr.row - prev.row
      const dc = prev.col > curr.col ? prev.col - curr.col : curr.col - prev.col
      if (dr !== 1 || dc !== 1) continue

      const sqRow = prev.row < curr.row ? prev.row : curr.row
      const sqCol = prev.col < curr.col ? prev.col : curr.col
      const isBackslash =
        (prev.row < curr.row && prev.col < curr.col) ||
        (prev.row > curr.row && prev.col > curr.col)
      const diagSlot = isBackslash ? 0 : 1
      const crossingSlot = diagSlot ^ 1
      const diagBase = ((prev.z * (this.rows - 1) + sqRow) * sqCols + sqCol) * 2
      const crossingIdx = diagBase + crossingSlot
      const crossingOcc = this.usedDiagFlat[crossingIdx]!
      const crossingSameRoot =
        this.connIdToRootNet[crossingOcc] === this.connIdToRootNet[connId]
      const allowCrossingOverlap =
        crossingSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
      if (
        crossingOcc !== -1 &&
        crossingOcc !== connId &&
        !allowCrossingOverlap
      ) {
        continue
      }

      const diagIdx = diagBase + diagSlot
      this.usedDiagFlat[diagIdx] = connId
      diagIndices.push(diagIdx)
    }

    // Store used indices for this connection
    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push([])
    }
    const usedIndices = this.usedIndicesByConn[connId] ?? []
    usedIndices.push(...indices)
    this.usedIndicesByConn[connId] = usedIndices
    while (this.usedDiagIndicesByConn.length <= connId) {
      this.usedDiagIndicesByConn.push([])
    }
    const usedDiagIndices = this.usedDiagIndicesByConn[connId] ?? []
    usedDiagIndices.push(...diagIndices)
    this.usedDiagIndicesByConn[connId] = usedDiagIndices

    // Store solved route (cell-based)
    const solvedRoutes = this.solvedRoutes.get(connId) ?? []
    solvedRoutes.push({
      connId,
      startZ: firstCell.z,
      startRow: firstCell.row,
      startCol: firstCell.col,
      startPoint: this.activeConnSeg!.startPoint,
      endZ: lastCell.z,
      endRow: lastCell.row,
      endCol: lastCell.col,
      endPoint: this.activeConnSeg!.endPoint,
      cells,
      viaCells,
    })
    this.solvedRoutes.set(connId, solvedRoutes)

    if (this.useExactViaTraceClearance) {
      while (this.viaCenterIndicesByConn.length <= connId) {
        this.viaCenterIndicesByConn.push([])
      }
      const viaCenterIndices = this.viaCenterIndicesByConn[connId] ?? []
      for (const via of viaCells) {
        const viaCenterIndex = via.row * this.cols + via.col
        const owners = this.viaOwnersByCell.get(viaCenterIndex) ?? new Set()
        if (!owners.has(connId)) {
          owners.add(connId)
          viaCenterIndices.push(viaCenterIndex)
        }
        this.viaOwnersByCell.set(viaCenterIndex, owners)
      }
      this.viaCenterIndicesByConn[connId] = viaCenterIndices
    }

    // Rip connections displaced by via footprints
    for (let i = 0; i < displacedByVias.length; i++) {
      this.ripTrace(displacedByVias[i]!)
      if (this.failed) return
    }
    // Penalty decay to prevent death spiral
    if (rippedIds.length > 0 || displacedByVias.length > 0) {
      const pen = this.penalty2d
      const cap = this.penaltyCap
      if (this.totalRipEvents > 50) {
        // High-contention mode: global decay to help stuck connections converge
        for (let i = 0; i < pen.length; i++) {
          pen[i] = pen[i]! * 0.99
        }
      } else {
        // Normal mode: targeted decay only for above-cap cells
        for (let i = 0; i < pen.length; i++) {
          if (pen[i]! > cap) {
            pen[i] = pen[i]! * 0.5
          }
        }
      }
    }
  }

  // --- Rip a trace ---
  private ripTrace(connId: ConnId): void {
    if (!this.ownerCutAllowedRipOwners?.has(connId))
      throw new Error("Owner-cut commit attempted an unpermitted route displacement")
    while (this.ripCount.length <= connId) this.ripCount.push(0)
    this.ripCount[connId]!++
    this.totalRipEvents++
    if (this.totalRipEvents >= this.MAX_RIPS) {
      this.error = `Convergence failure: exceeded MAX_RIPS ${this.MAX_RIPS}`
      this.failed = true
      return
    }

    const routes = this.solvedRoutes.get(connId) ?? []

    // Add rip penalties to penalty map along the ripped route
    if (routes.length > 0) {
      const cols = this.cols
      for (const route of routes) {
        for (let i = 0; i < route.cells.length; i++) {
          const cell = route.cells[i]!
          const cellIdx = cell.row * cols + cell.col
          this.penalty2d[cellIdx] =
            this.penalty2d[cellIdx]! + this.hyperParameters.ripTracePenalty
        }
        for (let i = 0; i < route.viaCells.length; i++) {
          const via = route.viaCells[i]!
          const viaIdx = via.row * cols + via.col
          this.penalty2d[viaIdx] =
            this.penalty2d[viaIdx]! + this.hyperParameters.ripViaPenalty
        }
      }
    }

    // Clear used cells using tracked indices
    const indices = this.usedIndicesByConn[connId]
    if (indices) {
      const used = this.usedCellsFlat
      for (let i = 0; i < indices.length; i++) {
        const flatIdx = indices[i]!
        if (used[flatIdx] === connId) {
          used[flatIdx] = -1
        }
      }
      this.usedIndicesByConn[connId] = []
    }

    const diagIndices = this.usedDiagIndicesByConn[connId]
    if (diagIndices) {
      const usedDiag = this.usedDiagFlat
      for (let i = 0; i < diagIndices.length; i++) {
        const flatIdx = diagIndices[i]!
        if (usedDiag[flatIdx] === connId) {
          usedDiag[flatIdx] = -1
        }
      }
      this.usedDiagIndicesByConn[connId] = []
    }

    const viaCenterIndices = this.viaCenterIndicesByConn[connId]
    if (viaCenterIndices) {
      for (const viaCenterIndex of viaCenterIndices) {
        const owners = this.viaOwnersByCell.get(viaCenterIndex)
        if (!owners) continue
        owners.delete(connId)
        if (owners.size === 0) {
          this.viaOwnersByCell.delete(viaCenterIndex)
        }
      }
      this.viaCenterIndicesByConn[connId] = []
    }

    // Move from solved back to unsolved
    if (routes.length > 0) {
      this.solvedRoutes.delete(connId)
      for (const route of routes) {
        this.unsolvedSegs.push({
          connId,
          startZ: route.startZ,
          startRow: route.startRow,
          startCol: route.startCol,
          startPoint: route.startPoint,
          endZ: route.endZ,
          endRow: route.endRow,
          endCol: route.endCol,
          endPoint: route.endPoint,
        })
      }
    }
  }

  override visualize() {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]

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

    // Draw grid bounds
    const { width, height, center } = this.nodeWithPortPoints
    rects.push({
      center: { x: center.x, y: center.y },
      width,
      height,
      stroke: "gray",
    })

    const vt = this.gridToBoundsTransform

    // Draw penalty map as transparent rects
    if (this.showPenaltyMap && this.penalty2d) {
      let maxPenalty = 0
      for (let i = 0; i < this.penalty2d.length; i++) {
        if (this.penalty2d[i]! > maxPenalty) maxPenalty = this.penalty2d[i]!
      }
      if (maxPenalty > 0) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const p = this.penalty2d[row * this.cols + col]!
            if (p <= 0) continue
            const alpha = Math.min(0.6, (p / maxPenalty) * 0.6)
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            rects.push({
              center: tc,
              width: this.cellSizeMm * vt.a,
              height: this.cellSizeMm * vt.e,
              fill: `rgba(255,165,0,${alpha.toFixed(3)})`,
            })
          }
        }
      }
    }

    // Draw used cells as transparent blue rects
    if (this.showUsedCellMap && this.usedCellsFlat) {
      for (let z = 0; z < this.layers; z++) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const occ =
              this.usedCellsFlat[(z * this.rows + row) * this.cols + col]!
            if (occ === -1) continue
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            rects.push({
              center: tc,
              width: this.cellSizeMm * vt.a,
              height: this.cellSizeMm * vt.e,
              fill: "rgba(0,0,255,0.5)",
            })
          }
        }
      }
    }

    // Draw port points colored by layer
    for (const pp of this.nodeWithPortPoints.portPoints) {
      points.push({
        x: pp.x,
        y: pp.y,
        color: LAYER_COLORS[pp.z] ?? "gray",
        label: pp.connectionName,
      })
    }

    // Draw solved routes, splitting segments by z-layer for coloring
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

    // Draw vias
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

    // Draw active A* exploration (scan visitedStamp for current stamp)
    if (this.activeConnSeg && this.visitedStamp) {
      const currentStamp = this.stamp
      for (let z = 0; z < this.layers; z++) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            if (
              this.visitedStamp[(z * this.rows + row) * this.cols + col] !==
              currentStamp
            )
              continue
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            points.push({
              x: tc.x,
              y: tc.y,
              color: "rgba(0,0,255,0.2)",
            })
          }
        }
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA01 [${this.solvedRoutes?.size ?? 0} solved, ${this.unsolvedSegs?.length ?? 0} remaining]`,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const t = this.gridToBoundsTransform
    const result: HighDensityIntraNodeRoute[] = []

    for (const [connId, routes] of this.solvedRoutes ?? []) {
      const connName = this.connIdToName[connId]!
      for (const route of routes) {
        const points = route.cells.map((cell) => {
          const rawX = this.gridOrigin.x + (cell.col + 0.5) * this.cellSizeMm
          const rawY = this.gridOrigin.y + (cell.row + 0.5) * this.cellSizeMm
          const tp = applyAffineTransformToPoint(t, { x: rawX, y: rawY })
          return { x: tp.x, y: tp.y, z: this.layerToZ.get(cell.z) ?? cell.z }
        })
        if (points.length > 0) {
          points[0] = { ...route.startPoint }
          if (points.length > 1) {
            points[points.length - 1] = { ...route.endPoint }
          }
        }
        result.push({
          connectionName: connName,
          rootConnectionName: this.connIdToRootNet[connId],
          regionId: this.nodeWithPortPoints.capacityMeshNodeId,
          traceThickness: this.traceThickness,
          viaDiameter: this.viaDiameter,
          route: points,
          vias: route.viaCells.map((via) => {
            const rawX = this.gridOrigin.x + (via.col + 0.5) * this.cellSizeMm
            const rawY = this.gridOrigin.y + (via.row + 0.5) * this.cellSizeMm
            return applyAffineTransformToPoint(t, { x: rawX, y: rawY })
          }),
        })
      }
    }

    return result
  }
}
