import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 feeds length-matched routes into coupled-pair processing", () => {
  const lengthOnlyPair = {
    connectionNames: ["LP", "LN"] as [string, string],
    lengthTolerance: 0.01,
  }
  const coupledPair = {
    connectionNames: ["CP", "CN"] as [string, string],
    lengthTolerance: 0.01,
    minimumCenterlineDistance: 0.3,
    maximumCenterlineDistance: 0.5,
  }
  const solver = new Pipeline9DifferentialPairPostProcessingSolver({
    hdRoutes: [
      {
        connectionName: "LP",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 6, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "LN",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 3, z: 0 },
          { x: 8, y: 3, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "CP",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 10, z: 0 },
          { x: 10, y: 10, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "CN",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 10.4, z: 0 },
          { x: 10, y: 10.4, z: 0 },
        ],
        vias: [],
      },
    ],
    differentialPairs: [lengthOnlyPair, coupledPair],
    obstacles: [],
    bounds: { minX: -2, maxX: 12, minY: -4, maxY: 14 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  while (!solver.postProcessingSolver && !solver.solved && !solver.failed)
    solver.step()
  expect(solver.solved).toBe(false)
  expect(solver.progress).toBe(0)
  solver.solve()

  const coupledInput = solver.postProcessingSolver?.getConstructorParams()[0]
  expect(coupledInput?.differentialPairs).toEqual([coupledPair])
  const getLength = (
    connectionName: string,
    hdRoutes = solver.getOutput().hdRoutes,
  ): number => {
    const route = hdRoutes.find(
      (candidate) => candidate.connectionName === connectionName,
    )
    if (!route) throw new Error(`Missing HD route for ${connectionName}`)
    return route.route.slice(1).reduce((length, point, index) => {
      const previous = route.route[index]!
      return length + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)
  }
  expect(
    Math.abs(
      getLength("LP", coupledInput?.hdRoutes) -
        getLength("LN", coupledInput?.hdRoutes),
    ),
  ).toBeLessThanOrEqual(lengthOnlyPair.lengthTolerance)
  expect(getLength("LP", coupledInput?.hdRoutes)).toBeGreaterThan(6)
  expect(Math.abs(getLength("LP") - getLength("LN"))).toBeLessThanOrEqual(
    lengthOnlyPair.lengthTolerance,
  )
  expect(Math.abs(getLength("CP") - getLength("CN"))).toBeLessThanOrEqual(
    coupledPair.lengthTolerance,
  )
  expect(solver.getOutput().postProcessingErrors).toEqual([])
})
