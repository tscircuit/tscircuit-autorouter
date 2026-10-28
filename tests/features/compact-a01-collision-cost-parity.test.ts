import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import type { CompactA01RippedConnection } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"
import { HighDensitySolverA01Compact, type HighDensitySolverA01CompactProps } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

interface CostState {
  rows: number
  cols: number
  usedCellsFlat: Int32Array
  usedDiagFlat: Int32Array
  portOwnerFlat: Int32Array
  penalty2d: Float64Array
  viaOwnersByCell: Map<number, Set<number>>
  viaOccupantsByCell: Map<number, readonly number[]>
  _moveCost: number
  _moveRipped: CompactA01RippedConnection | null
  computeMoveCostAndRips(active: number, fromZ: number, fromRow: number, fromCol: number, toZ: number, toRow: number, toCol: number, ripped: CompactA01RippedConnection | null): void
}

interface CompactCostState extends CostState {
  computeCompactMoveCostAndRips(state: CostState, active: number, fromZ: number, fromRow: number, fromCol: number, toZ: number, toRow: number, toCol: number, ripped: CompactA01RippedConnection | null): void
}

test("numeric ownership and victim membership preserve every collision cost and ordered rip chain", () => {
  const props: HighDensitySolverA01CompactProps = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "cost-parity", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: Array.from({ length: 32 }, (_, id) => [
        { x: -1, y: -0.9 + Math.min(id, 30) * 0.04, z: 0, connectionName: `net${id}`, rootConnectionName: id >= 30 ? "shared" : `net${id}` },
        { x: 1, y: -0.9 + Math.min(id, 30) * 0.04, z: 1, connectionName: `net${id}`, rootConnectionName: id >= 30 ? "shared" : `net${id}` },
      ]).flat(),
    },
    cellSizeMm: 0.1, viaDiameter: 0.3, traceMargin: 0.1,
  }
  const baseline = new HighDensitySolverA01(props)
  const compact = new HighDensitySolverA01Compact({ ...props, compactFrontierPruning: false })
  baseline.setup()
  compact.setup()
  const originalState = baseline as unknown as CostState
  const compactState = compact as unknown as CompactCostState
  for (const state of [originalState, compactState]) {
    for (let index = 0; index < state.usedCellsFlat.length; index++) {
      state.usedCellsFlat[index] = index % 5 === 0 ? index % 32 : -1
      state.portOwnerFlat[index] = index % 29 === 0 ? index % 32 : index % 47 === 0 ? -2 : -1
    }
    for (let index = 0; index < state.usedDiagFlat.length; index++) {
      state.usedDiagFlat[index] = index % 11 === 0 ? 31 : -1
    }
    for (let index = 0; index < state.penalty2d.length; index++) state.penalty2d[index] = index % 13 / 10
    state.viaOwnersByCell.set(105, new Set([0, 30, 31]))
    state.viaOwnersByCell.set(126, new Set([9, 31]))
  }
  const high: CompactA01RippedConnection = { id: 31, prev: null, compactMask: 2 ** 31 }
  const chain: CompactA01RippedConnection = { id: 4, prev: high, compactMask: (2 ** 31 + 2 ** 4) >>> 0 }
  for (const active of [0, 9, 30]) {
    for (const ripped of [null, high, chain]) {
      for (let row = 1; row < 18; row += 2) {
        for (let col = 1; col < 18; col += 2) {
          for (const [toZ, dr, dc] of [[0, 1, 0], [0, 0, 1], [0, 1, 1], [0, -1, 1], [1, 0, 0]]) {
            originalState.viaOccupantsByCell.clear()
            compactState.viaOccupantsByCell.clear()
            originalState.computeMoveCostAndRips(active, 0, row, col, toZ!, row + dr!, col + dc!, ripped)
            compactState.computeCompactMoveCostAndRips(compactState, active, 0, row, col, toZ!, row + dr!, col + dc!, ripped)
            expect(compactState._moveCost).toBe(originalState._moveCost)
            const originalIds: number[] = []
            const compactIds: number[] = []
            for (let cursor = originalState._moveRipped; cursor; cursor = cursor.prev) originalIds.push(cursor.id)
            for (let cursor = compactState._moveRipped; cursor; cursor = cursor.prev) compactIds.push(cursor.id)
            expect(compactIds).toEqual(originalIds)
          }
        }
      }
    }
  }
})
