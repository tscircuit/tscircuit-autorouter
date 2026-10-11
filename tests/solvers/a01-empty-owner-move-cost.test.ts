import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"

type ConnId = number
interface RippedNode {
  id: number
  prev: RippedNode | null
}
interface MoveCostState {
  rows: number
  cols: number
  cellSizeMm: number
  hyperParameters: { viaBaseCost: number; ripViaPenalty: number; ripTracePenalty: number }
  penalty2d: Float64Array
  penaltyCap: number
  portOwnerFlat: Int32Array
  usedCellsFlat: Int32Array
  usedDiagFlat: Int32Array
  connIdToRootNet: string[]
  overlapFriendlyRootNets: Set<string>
  activeConnSeg: { endZ: number; endRow: number; endCol: number } | null
  viaOwnersByCell: Map<number, Set<number>>
  ripCount: number[]
  _moveCost: number
  _moveRipped: RippedNode | null
  _viaOccs: number[]
  getRipCost(id: number): number
  fillViaOccupants(row: number, col: number, activeConn: number): void
  fillTraceSegmentViaOccupants(fromRow: number, fromCol: number, toRow: number, toCol: number, activeConn: number): void
  computeMoveCostAndRips(activeConn: number, fromZ: number, fromRow: number, fromCol: number, toZ: number, toRow: number, toCol: number, ripped: RippedNode | null): void
}

function rippedContains(r: RippedNode | null, id: number): boolean {
  for (let cur = r; cur; cur = cur.prev) {
    if (cur.id === id) return true
  }
  return false
}

// Exact original private method from the pinned A01 dependency. This oracle
// runs on actual solver instances, using their original cost and scratch state.
function originalComputeMoveCostAndRips(
    this: MoveCostState,
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

test("empty-owner gates preserve original A01 costs, ordered rips, routes and iterations", (): void => {
  const props: ConstructorParameters<typeof HighDensitySolverA01>[0] = {
    nodeWithPortPoints: { capacityMeshNodeId: "move-cost-grid", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1], portPoints: [] },
    cellSizeMm: 0.2,
    viaDiameter: 0.3,
  }
  const original = new HighDensitySolverA01(props)
  const optimized = new HighDensitySolverA01(props)
  original.setup()
  optimized.setup()
  const originalState = original as unknown as MoveCostState
  const optimizedState = optimized as unknown as MoveCostState
  for (const state of [originalState, optimizedState]) {
    state.connIdToRootNet = ["alias", "alias", "foreign", "other"]
    state.ripCount = [0, 3, 1, 2]
    state.penalty2d.fill(1.25)
    state.penaltyCap = 0.7
    state.viaOwnersByCell = new Map([[0, new Set([3])]])
    state.fillViaOccupants = (): void => { state._viaOccs = [3, 1, 2] }
    state.fillTraceSegmentViaOccupants = (): void => { state._viaOccs = [2, 3, 1] }
  }
  const moves: Array<[number, number, number, number, number, number]> = [
    [0, 3, 3, 0, 3, 4],
    [0, 3, 3, 0, 4, 4],
    [0, 3, 3, 1, 3, 3],
  ]
  const initialRipped: RippedNode = Object.freeze({ id: 2, prev: Object.freeze({ id: 3, prev: null }) })
  for (const move of moves) {
    const [fromZ, fromRow, fromCol, toZ, toRow, toCol] = move
    for (const fixedOwner of [-2, -1, 0, 1, 2]) {
      for (const occupant of [-2, -1, 0, 1, 2]) {
        for (const crossingOwner of [-1, 0, 1, 2]) {
          for (const friendly of [false, true]) {
            for (const goal of [null, { endZ: toZ, endRow: toRow, endCol: toCol }, { endZ: toZ ^ 1, endRow: toRow, endCol: toCol }]) {
              for (const ripped of [null, initialRipped]) {
                for (const state of [originalState, optimizedState]) {
                  state.portOwnerFlat.fill(-1)
                  state.usedCellsFlat.fill(-1)
                  state.usedDiagFlat.fill(-1)
                  const flatIndex = (toZ * state.rows + toRow) * state.cols + toCol
                  state.portOwnerFlat[flatIndex] = fixedOwner
                  state.usedCellsFlat[flatIndex] = occupant
                  const crossingIndex = ((toZ * (state.rows - 1) + fromRow) * (state.cols - 1) + fromCol) * 2 + 1
                  state.usedDiagFlat[crossingIndex] = crossingOwner
                  state.overlapFriendlyRootNets = friendly ? new Set(["alias"]) : new Set()
                  state.activeConnSeg = goal
                }
                originalComputeMoveCostAndRips.call(originalState, 0, fromZ, fromRow, fromCol, toZ, toRow, toCol, ripped)
                optimizedState.computeMoveCostAndRips(0, fromZ, fromRow, fromCol, toZ, toRow, toCol, ripped)
                expect(Object.is(optimizedState._moveCost, originalState._moveCost)).toBe(true)
                expect(optimizedState._moveRipped).toEqual(originalState._moveRipped)
              }
            }
          }
        }
      }
    }
  }
  expect(initialRipped).toEqual({ id: 2, prev: { id: 3, prev: null } })

  // Empty cells must avoid root-net array lookups entirely.
  let rootReads = 0
  optimizedState.connIdToRootNet = new Proxy(["alias", "alias"], { get(target, key, receiver): unknown { rootReads++; return Reflect.get(target, key, receiver) } })
  optimizedState.portOwnerFlat.fill(-1)
  optimizedState.usedCellsFlat.fill(-1)
  optimizedState.usedDiagFlat.fill(-1)
  optimizedState.viaOwnersByCell.clear()
  optimizedState.activeConnSeg = null
  optimizedState.computeMoveCostAndRips(0, 0, 3, 3, 0, 4, 4, null)
  expect(rootReads).toBe(0)

  const routeProps: ConstructorParameters<typeof HighDensitySolverA01>[0] = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "compact-crossing-aliases",
      center: { x: 0, y: 0 }, width: 1.8, height: 1.8, availableZ: [0, 1],
      portPoints: [
        { connectionName: "horizontal", rootConnectionName: "root_h", x: -0.8, y: 0, z: 0 },
        { connectionName: "horizontal", rootConnectionName: "root_h", x: 0.8, y: 0, z: 0 },
        { connectionName: "vertical", rootConnectionName: "root_v", x: 0, y: -0.8, z: 0 },
        { connectionName: "vertical", rootConnectionName: "root_v", x: 0, y: 0.8, z: 1 },
      ],
    },
    cellSizeMm: 0.2,
    viaDiameter: 0.3,
  }
  const originalRoutes = new HighDensitySolverA01(structuredClone(routeProps))
  const optimizedRoutes = new HighDensitySolverA01(structuredClone(routeProps))
  ;(originalRoutes as unknown as MoveCostState).computeMoveCostAndRips = originalComputeMoveCostAndRips
  originalRoutes.solve()
  optimizedRoutes.solve()
  expect(optimizedRoutes.solved).toBe(true)
  expect(optimizedRoutes.failed).toBe(false)
  expect(optimizedRoutes.solved).toBe(originalRoutes.solved)
  expect(optimizedRoutes.failed).toBe(originalRoutes.failed)
  expect(optimizedRoutes.iterations).toBe(originalRoutes.iterations)
  expect(optimizedRoutes.getOutput()).toEqual(originalRoutes.getOutput())
  expect(optimizedRoutes.getOutput()).toHaveLength(2)
})
