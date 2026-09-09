import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

test("publishes the SRJ18 repairs while the imported C43 pad still covers TP5", (): void => {
  // Five unchanged routes and their pad/net context from the video's final
  // sample16 output on d1e664f, before the dataset's trapezoid conversion fix.
  const originalSrj = fixture.srj as SimpleRouteJson
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const original = structuredClone(routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({
    routes: candidate,
  }): ReturnType<DrcEvaluator> => {
    if (!candidate) throw new Error("Missing candidate routes")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: candidate,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const result = applyPipeline9BoundedRegionalRepairs({
    originalSrj,
    routes,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    viaHoleDiameter: 0.15,
  })
  const reference = drcEvaluator({ traces: [], routes: result.routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  expect(result.initialDrcIssueCount).toBe(4)
  expect(errors).toHaveLength(2)
  expect(errors.map((error) => error.pcb_trace_error_id).sort()).toEqual([
    "overlap_source_trace_15__source_net_15_mst4_0_pcb_smtpad_62",
    "overlap_source_trace_15__source_net_15_mst6_0_pcb_smtpad_62",
  ])
  expect(result.publishedDrcIssueCount).toBe(2)
  expect(result.repaired).toBeFalse()
  expect(result.routes).not.toBe(routes)
  expect(routes).toEqual(original)
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
  }
})
