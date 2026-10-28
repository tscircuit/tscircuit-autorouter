import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import {
  CompactA01Frontier,
  type CompactA01Label,
  type CompactA01RippedConnection,
} from "./CompactA01Frontier"

// Search/collision logic adapted from tscircuit/high-density-a01@10cdce5.
// Copyright (c) 2026 tscircuit. Distributed under the MIT license in LICENSE.

export type HighDensitySolverA01CompactProps = ConstructorParameters<
  typeof HighDensitySolverA01
>[0] & { compactFrontierPruning?: boolean }

interface A01ConnectionSegment {
  connId: number
  startZ: number
  startRow: number
  startCol: number
  endZ: number
  endRow: number
  endCol: number
}

/**
 * Deliberate adapter to high-density-a01@10cdce5. Reuse its geometry helpers,
 * rip ordering, setup and route finalization. The numeric move-cost loop below
 * is an equivalence-tested adaptation of that pinned implementation.
 * TypeScript private fields are ordinary properties in this dependency.
 */
interface A01SearchState {
  rows: number
  cols: number
  layers: number
  planeSize: number
  connIdToName: string[]
  connIdToRootNet: string[]
  overlapFriendlyRootNets: Set<string>
  cellSizeMm: number
  hyperParameters: { viaBaseCost: number; ripTracePenalty: number; ripViaPenalty: number }
  penaltyCap: number
  portOwnerFlat: Int32Array
  usedCellsFlat: Int32Array
  usedDiagFlat: Int32Array
  viaOwnersByCell: Map<number, Set<number>>
  _viaOccs: number[]
  fillViaOccupants(row: number, col: number, activeConn: number): void
  fillTraceSegmentViaOccupants(fromRow: number, fromCol: number, toRow: number, toCol: number, activeConn: number): void
  activeConnSeg: A01ConnectionSegment | null
  activeConnId: number
  crossLayerSearch: boolean
  unsolvedSegs: A01ConnectionSegment[]
  nodePool: CompactA01Label[]
  heap: { readonly size: number; clear(): void }
  seqCounter: number
  searchIterations: number
  baseSearchBudgetIters: number
  ripCount: number[]
  penalty2d: Float64Array
  consecutiveSkips: number
  visitedStamp: Uint32Array
  stamp: number
  minViaRow: number
  maxViaRow: number
  minViaCol: number
  maxViaCol: number
  viaOccupantsByCell: Map<number, readonly number[]>
  _moveCost: number
  _moveRipped: CompactA01RippedConnection | null
  nextStamp(): void
  computeH(z: number, row: number, col: number, toZ: number, toRow: number, toCol: number): number
  computeMoveCostAndRips(activeConn: number, fromZ: number, fromRow: number, fromCol: number, toZ: number, toRow: number, toCol: number, ripped: CompactA01RippedConnection | null): void
  finalizeRoute(goalNode: number): void
}

const ROW_OFFSETS = [-1, -1, -1, 0, 0, 1, 1, 1] as const
const COL_OFFSETS = [-1, 0, 1, -1, 1, -1, 0, 1] as const

/**
 * A01 with reusable typed label/heap storage and experimental exact-victim-set
 * queue pruning. The representation-only ablation disables that pruning.
 */
export class HighDensitySolverA01Compact extends HighDensitySolverA01 {
  readonly compactFrontierPruning: boolean
  compactFrontier?: CompactA01Frontier
  private compactState?: A01SearchState
  private compactOwnerCount = 0
  private compactOverlapAllowed = new Uint8Array(0)

  static isSupported(props: HighDensitySolverA01CompactProps): boolean {
    const node = props.nodeWithPortPoints
    const layers = node.availableZ?.length ?? new Set(node.portPoints.map((point) => point.z)).size
    const states = Math.floor(node.width / props.cellSizeMm) * Math.floor(node.height / props.cellSizeMm) * layers
    const connections = new Set(node.portPoints.map((point) => point.connectionName)).size
    return connections <= 32 && Number.isSafeInteger(states) && states > 0 && states < 2 ** 21
  }

  constructor(props: HighDensitySolverA01CompactProps) {
    if (!HighDensitySolverA01Compact.isSupported(props)) {
      throw new Error("Unsupported compact A01 scene: select the original A01 before construction")
    }
    super(props)
    this.compactFrontierPruning = props.compactFrontierPruning ?? true
  }

  override getSolverName(): string {
    // Preserve the portfolio's public name and instanceof-based work units.
    return "HighDensitySolverA01"
  }

  override getConstructorParams(): [HighDensitySolverA01CompactProps] {
    return [{
      ...super.getConstructorParams()[0],
      compactFrontierPruning: this.compactFrontierPruning,
    }]
  }

  override _setup(): void {
    super._setup()
    if (this.failed) return
    const state = this as unknown as A01SearchState
    const states = state.rows * state.cols * state.layers
    if (
      !Number.isSafeInteger(states) || states <= 0 || states >= 2 ** 21 ||
      state.connIdToName.length > 32 || state.visitedStamp.length !== states ||
      state.connIdToRootNet.length !== state.connIdToName.length ||
      state.planeSize !== state.rows * state.cols ||
      !(state.portOwnerFlat instanceof Int32Array) || state.portOwnerFlat.length !== states ||
      !(state.usedCellsFlat instanceof Int32Array) || state.usedCellsFlat.length !== states ||
      !(state.usedDiagFlat instanceof Int32Array) ||
      !(state.overlapFriendlyRootNets instanceof Set) ||
      !(state.penalty2d instanceof Float64Array) ||
      !(state.viaOccupantsByCell instanceof Map) ||
      typeof state.computeMoveCostAndRips !== "function" ||
      typeof state.fillViaOccupants !== "function" ||
      typeof state.fillTraceSegmentViaOccupants !== "function" ||
      typeof state.finalizeRoute !== "function" ||
      typeof state.computeH !== "function" || typeof state.nextStamp !== "function"
    ) {
      throw new Error("Compact A01 post-setup invariant failed; check the pinned A01 adapter and actual scene dimensions")
    }
    for (const segment of state.unsolvedSegs) {
      if (!Number.isInteger(segment.connId) || segment.connId < 0 || segment.connId >= 32) {
        throw new Error(`Compact A01 post-setup connection ID out of range: ${segment.connId}`)
      }
    }
    this.compactOwnerCount = state.connIdToName.length
    this.compactOverlapAllowed = new Uint8Array(this.compactOwnerCount ** 2)
    for (let active = 0; active < this.compactOwnerCount; active++) {
      for (let owner = 0; owner < this.compactOwnerCount; owner++) {
        if (state.connIdToRootNet[active] === state.connIdToRootNet[owner] &&
          state.overlapFriendlyRootNets.has(state.connIdToRootNet[active]!)) {
          this.compactOverlapAllowed[active * this.compactOwnerCount + owner] = 1
        }
      }
    }
    this.compactFrontier = new CompactA01Frontier(states, this.compactFrontierPruning)
    this.compactState = state
    // Original debug openSet reads heap.size. No object labels are needed by
    // its visualize/output implementation until route finalization.
    state.heap = this.compactFrontier
    this.stats.compactA01 = this.compactFrontier.metrics
    this.stats.compactFrontierPruning = this.compactFrontierPruning
  }

  override _step(): void {
    const state = this.compactState
    const frontier = this.compactFrontier
    if (!state || !frontier) throw new Error("Compact A01 stepped before successful setup")
    for (let substep = 0; substep < this.stepMultiplier; substep++) {
      if (this.solved || this.failed) return
      this.advanceCompactSearch(state, frontier)
    }
  }

  private advanceCompactSearch(state: A01SearchState, frontier: CompactA01Frontier): void {
    if (!state.activeConnSeg) {
      if (state.unsolvedSegs.length === 0) {
        this.solved = true
        frontier.clear()
        return
      }
      const next = state.unsolvedSegs.shift()!
      state.activeConnSeg = next
      state.activeConnId = next.connId
      state.crossLayerSearch = next.startZ !== next.endZ
      state.viaOccupantsByCell.clear()
      state.nodePool = []
      frontier.clear()
      frontier.metrics.searches++
      state.searchIterations = 0
      state.nextStamp()
      const h = state.computeH(next.startZ, next.startRow, next.startCol, next.endZ, next.endRow, next.endCol)
      const cell = (next.startZ * state.rows + next.startRow) * state.cols + next.startCol
      frontier.enqueue(cell, 0, h * this.hyperParameters.greedyMultiplier, -1, null)
      return
    }

    state.searchIterations++
    const connectionRips = state.ripCount[state.activeConnId] ?? 0
    const budget = Math.round(state.baseSearchBudgetIters * (1 + Math.min(connectionRips, 10) * 0.25))
    if (state.searchIterations > budget) {
      for (let index = 0; index < state.penalty2d.length; index++) {
        state.penalty2d[index] = state.penalty2d[index]! * 0.9
      }
      state.unsolvedSegs.push(state.activeConnSeg)
      state.activeConnSeg = null
      state.activeConnId = -1
      frontier.clear()
      state.nodePool = []
      state.consecutiveSkips++
      if (state.consecutiveSkips >= state.unsolvedSegs.length * 3) {
        this.error = `Convergence failure: ${state.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
      return
    }

    if (frontier.size === 0) {
      this.error = `No path found for ${state.connIdToName[state.activeConnId]}`
      this.failed = true
      return
    }
    const label = frontier.pop()
    const cell = frontier.cells[label]!
    if (state.visitedStamp[cell] === state.stamp) {
      frontier.metrics.alreadyVisited++
      return
    }
    state.visitedStamp[cell] = state.stamp
    const z = Math.floor(cell / state.planeSize)
    const row = Math.floor((cell - z * state.planeSize) / state.cols)
    const col = cell - z * state.planeSize - row * state.cols
    const segment = state.activeConnSeg
    if (z === segment.endZ && row === segment.endRow && col === segment.endCol) {
      state.nodePool = frontier.materializePath(label, state.rows, state.cols)
      state.finalizeRoute(state.nodePool.length - 1)
      state.activeConnSeg = null
      state.activeConnId = -1
      return
    }

    frontier.metrics.expanded++
    const g = frontier.costs[label]!
    const ripped = frontier.ripped[label]!
    for (let direction = 0; direction < 8; direction++) {
      const nextRow = row + ROW_OFFSETS[direction]!
      const nextCol = col + COL_OFFSETS[direction]!
      if (nextRow < 0 || nextRow >= state.rows || nextCol < 0 || nextCol >= state.cols) continue
      const nextCell = (z * state.rows + nextRow) * state.cols + nextCol
      if (state.visitedStamp[nextCell] === state.stamp) continue
      this.computeCompactMoveCostAndRips(state, state.activeConnId, z, row, col, z, nextRow, nextCol, ripped)
      if (state._moveCost < 0) continue
      const nextG = g + state._moveCost
      const nextF = nextG + state.computeH(z, nextRow, nextCol, segment.endZ, segment.endRow, segment.endCol) * this.hyperParameters.greedyMultiplier
      frontier.enqueue(nextCell, nextG, nextF, label, state._moveRipped)
    }

    if (row >= state.minViaRow && row <= state.maxViaRow && col >= state.minViaCol && col <= state.maxViaCol) {
      for (let nextZ = 0; nextZ < state.layers; nextZ++) {
        if (nextZ === z) continue
        const nextCell = (nextZ * state.rows + row) * state.cols + col
        if (state.visitedStamp[nextCell] === state.stamp) continue
        this.computeCompactMoveCostAndRips(state, state.activeConnId, z, row, col, nextZ, row, col, ripped)
        if (state._moveCost < 0) continue
        const nextG = g + state._moveCost
        const nextF = nextG + state.computeH(nextZ, row, col, segment.endZ, segment.endRow, segment.endCol) * this.hyperParameters.greedyMultiplier
        frontier.enqueue(nextCell, nextG, nextF, label, state._moveRipped)
      }
    }
  }

  private computeCompactMoveCostAndRips(
    state: A01SearchState,
    activeConn: number,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: CompactA01RippedConnection | null,
  ): void {
    let cost = 0
    let r = ripped
    if (r && r.compactMask === undefined) throw new Error("Compact A01 received an unencoded victim chain")
    const cols = state.cols

    if (fromZ !== toZ) {
      // Via transition
      cost += state.hyperParameters.viaBaseCost
      cost += Math.min(state.penalty2d[toRow * cols + toCol]!, state.penaltyCap)

      const toFlatIdx = (toZ * state.rows + toRow) * cols + toCol
      const fixedOwner = state.portOwnerFlat[toFlatIdx]!
      const allowFixedOverlap =
        this.compactOverlapAllowed[activeConn * this.compactOwnerCount + fixedOwner] === 1
      const seg = state.activeConnSeg
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
        state._moveCost = -1
        state._moveRipped = r
        return
      }

      // Via footprint occupants (reusable scratch array)
      state.fillViaOccupants(toRow, toCol, activeConn)
      const occs = state._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (((r?.compactMask ?? 0) & (1 << occ)) === 0) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r, compactMask: ((r?.compactMask ?? 0) | (1 << occ)) >>> 0 }
        }
        cost += state.hyperParameters.ripViaPenalty
      }
    } else {
      // Lateral movement
      const dr = fromRow > toRow ? fromRow - toRow : toRow - fromRow
      const dc = fromCol > toCol ? fromCol - toCol : toCol - fromCol
      cost += (dr + dc > 1 ? Math.SQRT2 : 1) * state.cellSizeMm
      cost += Math.min(state.penalty2d[toRow * cols + toCol]!, state.penaltyCap)

      const flatIdx = (toZ * state.rows + toRow) * cols + toCol
      const fixedOwner = state.portOwnerFlat[flatIdx]!
      const allowFixedOverlap =
        this.compactOverlapAllowed[activeConn * this.compactOwnerCount + fixedOwner] === 1
      const seg = state.activeConnSeg
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
        state._moveCost = -1
        state._moveRipped = r
        return
      }

      const occ = state.usedCellsFlat[flatIdx]!
      const allowSameRootOverlap =
        this.compactOverlapAllowed[activeConn * this.compactOwnerCount + occ] === 1
      if (occ !== -1 && occ !== activeConn && !allowSameRootOverlap) {
        if (((r?.compactMask ?? 0) & (1 << occ)) === 0) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r, compactMask: ((r?.compactMask ?? 0) | (1 << occ)) >>> 0 }
        }
        cost += state.hyperParameters.ripTracePenalty
      }

      // usedCellsFlat only records occupied grid points. A diagonal segment
      // can pass between those points and clip a via, so check the actual
      // output-space segment against nearby via centers as well.
      if (state.viaOwnersByCell.size > 0) {
        state.fillTraceSegmentViaOccupants(
          fromRow,
          fromCol,
          toRow,
          toCol,
          activeConn,
        )
        const viaOccs = state._viaOccs
        for (let i = 0; i < viaOccs.length; i++) {
          const viaOwner = viaOccs[i]!
          if (((r?.compactMask ?? 0) & (1 << viaOwner)) === 0) {
            cost += this.getRipCost(viaOwner)
            r = { id: viaOwner, prev: r, compactMask: ((r?.compactMask ?? 0) | (1 << viaOwner)) >>> 0 }
          }
          cost += state.hyperParameters.ripViaPenalty
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
        const sqCols = state.cols - 1
        const diagBase = ((toZ * (state.rows - 1) + sqRow) * sqCols + sqCol) * 2
        const crossingOcc = state.usedDiagFlat[diagBase + crossingSlot]!
        const allowCrossingOverlap =
          this.compactOverlapAllowed[activeConn * this.compactOwnerCount + crossingOcc] === 1
        if (
          crossingOcc !== -1 &&
          crossingOcc !== activeConn &&
          !allowCrossingOverlap
        ) {
          state._moveCost = -1
          state._moveRipped = r
          return
        }
      }
    }

    state._moveCost = cost
    state._moveRipped = r
  }
}
