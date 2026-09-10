import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyPipeline9TraceShortcuts } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TraceShortcuts"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("post-repair shortcuts remove bends without replacing existing DRC conflicts", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 2, y: 0, z: 0 }],
  }
  const original = structuredClone(route)
  const input = {
    routes: [route], otherHdRoutes: [], colorMap: {}, connMap: new ConnectivityMap({}),
    srj: { layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [], bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } },
  }
  const shortened = applyPipeline9TraceShortcuts({ ...input, drcEvaluator: () => [] })
  expect(shortened[0]!.route).toEqual([route.route[0]!, route.route.at(-1)!])
  for (const after of [
    [{ type: "pcb_trace_error", center: { x: 1, y: 0 } }],
    [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }, { type: "pcb_trace_error", center: { x: 0, y: 0 } }],
  ]) {
    let evaluations = 0
    const rejected = applyPipeline9TraceShortcuts({
      ...input,
      drcEvaluator: () => {
        evaluations++
        if (evaluations === 1) return [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }]
        return after
      },
    })
    expect(evaluations).toBe(2)
    expect(rejected).toEqual([original])
  }
  expect(route).toEqual(original)
})
