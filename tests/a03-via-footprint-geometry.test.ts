import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"

test("A03 cached via footprints match circle intersections across fine and coarse grid boundaries", (): void => {
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "via-footprint-geometry",
      center: { x: 0.3, y: -0.2 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [],
    },
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    highResolutionCellThickness: 2,
    viaDiameter: 0.3,
    traceThickness: 0.12,
    traceMargin: 0.1,
  })
  solver.setup()
  expect(solver.failed).toBeFalse()
  const radius = 0.3 / 2 + 0.12 / 2 + 0.1

  for (let cellId = 0; cellId < solver.planeSize; cellId++) {
    const cx = solver.cellCenterX[cellId]!
    const cy = solver.cellCenterY[cellId]!
    const expectedCellIds: number[] = []
    for (let candidateId = 0; candidateId < solver.planeSize; candidateId++) {
      const dx = Math.max(
        solver.cellMinX[candidateId]! - cx,
        0,
        cx - solver.cellMaxX[candidateId]!,
      )
      const dy = Math.max(
        solver.cellMinY[candidateId]! - cy,
        0,
        cy - solver.cellMaxY[candidateId]!,
      )
      if (dx * dx + dy * dy <= radius * radius) {
        expectedCellIds.push(candidateId)
      }
    }
    const footprint = solver["getViaFootprintCellIds"](cellId)
    expect(Array.from(footprint)).toEqual(expectedCellIds)
    expect(solver["getViaFootprintCellIds"](cellId)).toBe(footprint)
  }
})
