import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import {
  convertRepairRoutesToTraces,
  getFixedObstacleViolations,
} from "@tscircuit/repair04"
import { Pipeline9NegotiatedClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NegotiatedClearanceSolver"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("negotiation repairs earlier unfixed copper and publishes it with its original identity", (): void => {
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
        connectedTo: ["foreign-pad"],
      },
    ],
  }
  const connMap = new ConnectivityMap({
    retained: ["retained-net", "retained-id"],
    fixed: ["fixed-net", "fixed-id"],
    fresh: ["fresh"],
  })
  const preloaded: SimplifiedPcbTraces = [0, 2].map((y, index) => ({
    type: "pcb_trace",
    pcb_trace_id: index ? "fixed-id" : "retained-id",
    connection_name: index ? "fixed-net" : "retained-net",
    isFixed: index === 1,
    route: [
      { route_type: "wire", x: -4.5, y, width: 0.1, layer: "top" },
      { route_type: "wire", x: 4.5, y, width: 0.1, layer: "top" },
    ],
  }))
  const original = structuredClone(preloaded)
  const asHd = (traces: SimplifiedPcbTraces): HighDensityRoute[] =>
    traces.map((trace) =>
      convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: 1,
        defaultTraceThickness: 0.1,
        defaultViaDiameter: 0.3,
        rootConnectionName: trace.connection_name,
      }),
    )
  const fresh: HighDensityRoute = {
    connectionName: "fresh",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -4.5, y: 0.35, z: 0 },
      { x: 4.5, y: 0.35, z: 0 },
    ],
  }
  const engine = new AutoroutingDrcEngine(
    { ...srj, traces: undefined },
    { traceClearance: 0.1, viaClearance: 0.1 },
  )
  const evaluate = (
    routes: HighDensityRoute[],
    traces: SimplifiedPcbTraces,
  ): { errorCount: number; dirtyRouteIndices: number[] } => ({
    errorCount:
      engine.evaluate(
        convertRepairRoutesToTraces([...routes, ...asHd(traces)], 1),
      ).errors.length +
      getFixedObstacleViolations({
        srj: { ...srj, traces: undefined },
        routes: [...routes, ...asHd(traces)],
      }).length,
    dirtyRouteIndices: [0, 1],
  })
  expect(evaluate([fresh], preloaded).errorCount).toBeGreaterThan(0)
  const solver = new Pipeline9NegotiatedClearanceSolver({
    srj,
    connMap,
    routes: [fresh],
    fixedRoutes: asHd(preloaded.slice(1)),
    preloaded: { traces: preloaded, viaDiameter: 0.3, viaHoleDiameter: 0.15 },
    effort: 2,
    evaluate,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getUpdatedPreloadedTraces()
  expect(evaluate(solver.getOutput(), output).errorCount).toBe(0)
  expect(solver.getOutput()).toHaveLength(1)
  expect(output).toHaveLength(2)
  expect(output[0]!.pcb_trace_id).toBe("retained-id")
  expect(output[0]!.connection_name).toBe("retained-net")
  expect(output[0]!.route).not.toEqual(original[0]!.route)
  expect(output[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(output[1]).toEqual(original[1])
  expect(preloaded).toEqual(original)
})
