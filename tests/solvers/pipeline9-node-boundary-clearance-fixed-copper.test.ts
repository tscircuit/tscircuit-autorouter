import { expect, test } from "bun:test"
import { segmentDistance } from "high-density-repair02/lib/high-density-repair-solver/functions/segmentDistance"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 node boundary repair preserves fixed copper clearance", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: -0.79, z: 0 },
      { x: 1, y: -0.79, z: 0 },
    ],
  }
  const fixed: HighDensityRoute = {
    ...route,
    connectionName: "neighbor-trace",
    regionId: "neighbor",
    route: [
      { x: -1.3, y: -1.02, z: 0 },
      { x: 1.3, y: -1.02, z: 0 },
    ],
  }
  const original = structuredClone([route, fixed])
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [],
      },
    ],
    hdRoutes: [route, fixed],
    obstacles: [
      {
        type: "rect",
        center: { x: -0.3, y: -0.54 },
        width: 0.8,
        height: 0.4,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    enableNodeBoundaryClearanceRepair: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.sampleEntries[0]!.sample.fixedHdRoutes).toHaveLength(1)
  expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBeGreaterThan(0)
  const [output, fixedOutput] = solver.getOutput()
  expect(fixedOutput).toEqual(fixed)
  expect([route, fixed]).toEqual(original)
  expect(output!.route[0]).toEqual(route.route[0])
  expect(output!.route.at(-1)).toEqual(route.route.at(-1))
  for (let index = 1; index < output!.route.length; index++) {
    expect(
      segmentDistance(
        output!.route[index - 1]!,
        output!.route[index]!,
        fixed.route[0]!,
        fixed.route[1]!,
      ) - 0.1,
    ).toBeGreaterThanOrEqual(0.1 - 1e-9)
  }
})
