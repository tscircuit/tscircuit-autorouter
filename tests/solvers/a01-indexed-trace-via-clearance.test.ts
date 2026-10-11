import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"

type ViaClearanceState = {
  rows: number
  cols: number
  planeSize: number
  viaOwnersByCell: Map<number, Set<number>>
  outputCellStepX: number
  outputCellStepY: number
  viaTraceClearanceMm: number
  connIdToRootNet: string[]
  overlapFriendlyRootNets: Set<string>
  _viaOccs: number[]
  indexTraceClearanceViaOwners(): void
  fillTraceSegmentViaOccupants(...args: number[]): void
}

function getExpectedViaOccupants(
  state: ViaClearanceState,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  activeConn: number,
): number[] {
  const occupants: number[] = []
  const minRow = Math.min(fromRow, toRow)
  const maxRow = Math.max(fromRow, toRow)
  const minCol = Math.min(fromCol, toCol)
  const maxCol = Math.max(fromCol, toCol)
  const rowClearance = state.viaTraceClearanceMm / state.outputCellStepY
  const colClearance = state.viaTraceClearanceMm / state.outputCellStepX
  const segmentX = (toCol - fromCol) * state.outputCellStepX
  const segmentY = (toRow - fromRow) * state.outputCellStepY
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  const clearanceSquared = state.viaTraceClearanceMm ** 2
  for (const [viaIndex, owners] of state.viaOwnersByCell) {
    const row = Math.floor(viaIndex / state.cols)
    const col = viaIndex - row * state.cols
    if (
      row < minRow - rowClearance ||
      row > maxRow + rowClearance ||
      col < minCol - colClearance ||
      col > maxCol + colClearance
    ) {
      continue
    }
    const viaFromX = (col - fromCol) * state.outputCellStepX
    const viaFromY = (row - fromRow) * state.outputCellStepY
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (viaFromX * segmentX + viaFromY * segmentY) / lengthSquared,
            ),
          )
    const distanceX = viaFromX - segmentX * projection
    const distanceY = viaFromY - segmentY * projection
    if (distanceX * distanceX + distanceY * distanceY >= clearanceSquared) {
      continue
    }
    for (const owner of owners) {
      if (owner === activeConn) continue
      const sameRoot =
        state.connIdToRootNet[owner] === state.connIdToRootNet[activeConn]
      if (
        sameRoot &&
        state.overlapFriendlyRootNets.has(state.connIdToRootNet[activeConn]!)
      )
        continue
      if (!occupants.includes(owner)) occupants.push(owner)
    }
  }
  return occupants
}

test("indexed trace-via clearance preserves ordered occupants after routing and ripping", (): void => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "indexed-via-owners",
      center: { x: 0, y: 0 },
      width: 3.1,
      height: 3.5,
      availableZ: [0, 1],
      portPoints: [],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  })
  solver.setup()
  const state = solver as unknown as ViaClearanceState
  const owners = new Map<number, Set<number>>()
  for (let cell = state.planeSize - 1; cell >= 0; cell -= 11) {
    owners.set(cell, new Set([cell % 13, (cell * 3) % 13]))
  }
  state.viaOwnersByCell = owners
  state.connIdToRootNet = Array.from({ length: 13 }, (_, i) => `root${i % 5}`)
  state.overlapFriendlyRootNets = new Set(["root2"])
  for (let revision = 0; revision < 4; revision++) {
    state.indexTraceClearanceViaOwners()
    for (let row = 0; row < state.rows; row += 3) {
      for (let col = 0; col < state.cols; col += 3) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const toRow = row + dr
            const toCol = col + dc
            if (
              toRow < 0 ||
              toCol < 0 ||
              toRow >= state.rows ||
              toCol >= state.cols
            )
              continue
            for (let connection = 0; connection < 3; connection++) {
              state.fillTraceSegmentViaOccupants(
                row,
                col,
                toRow,
                toCol,
                connection,
              )
              expect(state._viaOccs).toEqual(
                getExpectedViaOccupants(
                  state,
                  row,
                  col,
                  toRow,
                  toCol,
                  connection,
                ),
              )
            }
          }
        }
      }
    }
    for (const cell of Array.from(owners.keys()).slice(0, 15))
      owners.delete(cell)
    owners.set(revision + 4, new Set([2, 8, 7]))
    if (revision === 2) {
      owners.clear()
      owners.set(5, new Set([2, 7]))
      owners.set(state.cols + 3, new Set([7, 8]))
      owners.set(state.planeSize - 4, new Set([9]))
    }
  }
})
