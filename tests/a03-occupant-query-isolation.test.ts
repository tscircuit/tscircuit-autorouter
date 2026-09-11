import { expect, test } from "bun:test"
import {
  HighDensitySolverA03,
  type NodeWithPortPoints,
} from "@tscircuit/high-density-a01"

test("A03 occupancy queries preserve conflict order across layers, edits and stamp rollover", (): void => {
  const connectionNames = ["active", "sibling", "first", "second"]
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "occupant-query-isolation",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: connectionNames.flatMap((connectionName, index) => [
      {
        connectionName,
        rootConnectionName: index < 2 ? "shared-root" : connectionName,
        x: -1.5,
        y: index * 0.5 - 1,
        z: 0,
      },
      {
        connectionName,
        rootConnectionName: index < 2 ? "shared-root" : connectionName,
        x: 1.5,
        y: index * 0.5 - 1,
        z: 1,
      },
    ]),
  }
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints,
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    highResolutionCellThickness: 2,
    viaDiameter: 0.3,
  })
  solver.setup()
  expect(solver.failed).toBeFalse()
  const active = solver["connNameToId"].get("active")!
  const sibling = solver["connNameToId"].get("sibling")!
  const first = solver["connNameToId"].get("first")!
  const second = solver["connNameToId"].get("second")!
  const occupiedCells = solver["usedCellsFlat"]
  const sharedCells = solver["sharedCellsFlat"]
  const cellId = Math.floor(solver.planeSize / 2)
  const traceOccupants: number[] = []

  // The same connections occur in many cells and on both layers.
  occupiedCells.fill(first)
  sharedCells.fill([active, second, sibling, first, second])
  solver["fillViaOccupants"](cellId, active)
  expect(solver["_viaOccs"]).toEqual([first, second])

  // A trace query changes both encounter order and the active connection.
  occupiedCells[0] = second
  sharedCells[0] = [first, first, active, sibling, second]
  solver["fillTraceOccupants"](0, first, traceOccupants)
  expect(traceOccupants).toEqual([second, active, sibling])
  occupiedCells[0] = first
  sharedCells[0] = [active, second, sibling, first, second]
  solver["fillViaOccupants"](cellId, active)
  expect(solver["_viaOccs"]).toEqual([first, second])

  // Rip-up/replacement between queries must immediately change conflicts.
  occupiedCells.fill(second)
  sharedCells.fill(undefined)
  solver["fillViaOccupants"](cellId, active)
  expect(solver["_viaOccs"]).toEqual([second])

  solver["occupantQueryStamp"] = 0xffffffff
  solver["occupantSeenStamp"].fill(1)
  solver["fillViaOccupants"](cellId, active)
  expect(solver["_viaOccs"]).toEqual([second])
  occupiedCells.fill(-1)
  solver["fillTraceOccupants"](0, active, traceOccupants)
  expect(traceOccupants).toEqual([])
})
