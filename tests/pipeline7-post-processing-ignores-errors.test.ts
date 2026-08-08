import { expect, test } from "bun:test"
import { DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/differential-pair-post-processing-solver"

test("returns routes without consuming post-processing errors", () => {
  const hdRoutes = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "N",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: -2, z: 0 },
        { x: 10, y: -2, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new DifferentialPairPostProcessingSolver({
    hdRoutes,
    differentialPairs: [
      {
        connectionNames: ["P", "N"],
        lengthTolerance: 0.01,
        minimumCenterlineDistance: 0.4,
        maximumCenterlineDistance: 0.6,
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 5, y: 0 },
        width: 12,
        height: 9,
        connectedTo: [],
      },
    ],
    bounds: { minX: -2, maxX: 12, minY: -5, maxY: 5 },
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.postProcessingSolver?.getOutput().postProcessingErrors,
  ).toHaveLength(1)
  expect(solver.getOutput()).toEqual({ hdRoutes })
})
