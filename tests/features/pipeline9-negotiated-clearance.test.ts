import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import {
  convertRepairRoutesToTraces,
  getFixedObstacleViolations,
} from "@tscircuit/repair04"
import { Pipeline9NegotiatedClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NegotiatedClearanceSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("higher-effort negotiation repairs coupled routes while preserving terminals and fixed copper", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -4.5, maxX: 4.5, minY: -4.5, maxY: 4.5 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["pad"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [0, 0.35, -0.35, 2].map((y, index) => ({
    connectionName: `route${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -4.5, y, z: 0 },
      { x: 4.5, y, z: 0 },
    ],
  }))
  const original = structuredClone(routes)
  const fixedRoutes = routes.slice(3)
  const engine = new AutoroutingDrcEngine(
    { ...srj, traces: undefined },
    {
      traceClearance: 0.1,
      viaClearance: 0.1,
    },
  )
  const countErrors = (candidate: HighDensityRoute[]): number =>
    engine.evaluate(
      convertRepairRoutesToTraces([...candidate, ...fixedRoutes], 1),
    ).errors.length +
    getFixedObstacleViolations({
      srj: { ...srj, traces: undefined },
      routes: [...candidate, ...fixedRoutes],
    }).length
  expect(countErrors(routes.slice(0, 3))).toBeGreaterThan(0)
  for (const effort of [1, 2]) {
    const solver = new Pipeline9NegotiatedClearanceSolver({
      srj,
      routes: routes.slice(0, 3),
      fixedRoutes,
      effort,
      evaluate: (candidate) => ({
        errorCount: countErrors(candidate),
        dirtyRouteIndices: candidate.map((_, index) => index),
      }),
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    const output = solver.getOutput()
    if (effort === 1) expect(output).toEqual(routes.slice(0, 3))
    else {
      expect(countErrors(output)).toBe(0)
      expect(solver.bestErrorCount).toBe(0)
      expect(solver.negotiationSolver!.getOutput().routes.at(-1)).toEqual(
        routes[3],
      )
    }
    for (let index = 0; index < output.length; index++) {
      expect(output[index]!.route[0]).toEqual(routes[index]!.route[0])
      expect(output[index]!.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    }
    expect(routes).toEqual(original)
  }
})
