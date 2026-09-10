import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9SameNetViaRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9SameNetViaRepairs"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a rejected net-wide merge does not discard an independent via repair", (): void => {
  const routes: HighDensityRoute[] = [0, 4].map((x, index) => ({
    connectionName: `route${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: x - 1, y: 0, z: 0 },
      { x, y: 0, z: 0 },
      { x, y: 0, z: 1 },
      { x: x + 0.02, y: 0, z: 1 },
      { x: x + 0.02, y: 0, z: 0 },
      { x: x + 1, y: 0, z: 0 },
    ],
    vias: [{ x, y: 0 }, { x: x + 0.02, y: 0 }],
  }))
  const original = structuredClone(routes)
  const conflicts = [0.01, 4.01].map((x) => ({
    type: "pcb_via_clearance_error",
    pcb_center: { x, y: 0 },
    actual_clearance: -0.28,
    minimum_clearance: 0.1,
  }))
  let rejectedWholeNet = false
  const drcEvaluator: DrcEvaluator = ({ hdRoutes }): Record<string, unknown>[] => {
    if (!hdRoutes) throw new Error("Expected high-density routes")
    const safeRouteChanged = !Bun.deepEquals(hdRoutes[0], original[0])
    const blockedRouteChanged = !Bun.deepEquals(hdRoutes[1], original[1])
    if (blockedRouteChanged) {
      if (safeRouteChanged) rejectedWholeNet = true
      return [{ type: "pcb_trace_error", pcb_trace_error_id: "new-short" }]
    }
    if (safeRouteChanged) return [conflicts[1]!]
    return conflicts
  }
  const output = applyPipeline9SameNetViaRepairs({
    routes,
    otherHdRoutes: [],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ signal: ["route0", "route1"] }),
    drcEvaluator,
  })
  expect(rejectedWholeNet).toBe(true)
  expect(output[0]).not.toEqual(original[0])
  expect(output[1]).toEqual(original[1])
  expect(output[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(routes).toEqual(original)
})
