import { expect, test } from "bun:test"
import { ApproximateLayerTransitionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateLayerTransitionSolver"

test("Pipeline10 materializes approximate layer changes before exact repair", () => {
  const solver = new ApproximateLayerTransitionSolver({
    hdRoutes: [
      {
        connectionName: "source_trace_1",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 1, z: 1 },
          { x: 4, y: 1, z: 1 },
        ],
        vias: [],
      },
      {
        connectionName: "source_trace_2",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 1, z: 1 },
          { x: 2, y: 1, z: 2 },
        ],
        vias: [],
      },
    ],
  })

  solver.solve()

  expect(solver.getOutput()[0]!.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 2, y: 1, z: 1 },
    { x: 4, y: 1, z: 1 },
  ])
  expect(solver.getOutput()[0]!.vias).toEqual([{ x: 2, y: 1 }])
  expect(solver.getOutput()[1]!.vias).toEqual([{ x: 2, y: 1 }])
  expect(solver.stats.materializedTransitionCount).toBe(2)
})
