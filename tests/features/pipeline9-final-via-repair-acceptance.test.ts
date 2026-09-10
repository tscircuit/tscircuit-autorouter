import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9SameNetViaRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9SameNetViaRepairs"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("final via repair preserves terminals and rejects new or changed conflicts", (): void => {
  const routes: HighDensityRoute[] = [{
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.02, y: 0, z: 1 },
      { x: 0.02, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [{ x: 0, y: 0 }, { x: 0.02, y: 0 }],
  }]
  const original = structuredClone(routes)
  const viaConflict = {
    type: "pcb_via_clearance_error",
    pcb_center: { x: 0.01, y: 0 },
    actual_clearance: -0.28,
    minimum_clearance: 0.1,
  }
  const params = {
    routes,
    otherHdRoutes: [],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ signalNet: ["signal"] }),
  }
  for (const remainingError of [
    { type: "pcb_trace_error", pcb_trace_error_id: "new-short" },
    { ...viaConflict, pcb_center: { x: 0.5, y: 0 } },
    { ...viaConflict, actual_clearance: -0.29 },
  ]) {
    let evaluations = 0
    const drcEvaluator: DrcEvaluator = (): Record<string, unknown>[] => {
      evaluations++
      if (evaluations === 1) return [viaConflict, viaConflict]
      return [remainingError]
    }
    expect(applyPipeline9SameNetViaRepairs({ ...params, drcEvaluator })).toBe(routes)
    expect(evaluations).toBe(2)
  }
  let evaluations = 0
  const repaired = applyPipeline9SameNetViaRepairs({
    ...params,
    drcEvaluator: (): Record<string, unknown>[] => {
      evaluations++
      if (evaluations === 1) return [viaConflict]
      return []
    },
  })
  expect(evaluations).toBe(2)
  expect(repaired).not.toEqual(routes)
  expect(repaired[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(repaired[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(routes).toEqual(original)
})
