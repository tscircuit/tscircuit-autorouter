import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { getMixedConnectionMinimumWidthNodeInput } from "../fixtures/getMixedConnectionMinimumWidthNodeInput"

test("mixed-width B01 routing preserves neighboring fixed copper", (): void => {
  const input = getMixedConnectionMinimumWidthNodeInput()
  for (const point of input.nodePortPoints[0].portPoints) {
    if (point.connectionName === "SIGNAL") point.y = 0.4
  }
  input.fixedHdRoutes.push({
    connectionName: "FIXED",
    rootConnectionName: "fixed",
    isFixed: true,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0.9, z: 0 },
      { x: 2, y: 0.9, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  })
  const original = structuredClone(input.fixedHdRoutes)
  const solver = new Pipeline9HighDensitySolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(input.fixedHdRoutes).toEqual(original)
  expect(solver.stats.b01NodeCount).toBe(1)
  expect(
    solver.routes.find((route) => route.connectionName === "POWER")
      ?.traceThickness,
  ).toBe(0.4)
  expect(
    solver.routes.find((route) => route.connectionName === "SIGNAL")
      ?.traceThickness,
  ).toBe(0.1)
  const fixed = original[0]
  for (const route of solver.routes) {
    for (let i = 1; i < route.route.length; i++) {
      expect(
        segmentToSegmentMinDistance(
          route.route[i - 1],
          route.route[i],
          fixed.route[0],
          fixed.route[1],
        ),
      ).toBeGreaterThanOrEqual(
        (route.traceThickness + fixed.traceThickness) / 2 + 0.1 - 1e-6,
      )
    }
  }
})
