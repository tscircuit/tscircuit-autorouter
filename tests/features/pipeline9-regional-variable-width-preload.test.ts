import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import {
  createRegionalFallbackProblem,
  spliceFixedRouteSectionWithMutationMask,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import {
  preparePipeline9MutatedPreloadedSections,
  applyPipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import type { SimplifiedPcbTrace } from "lib/types"

test("regional rerouting and cleanup preserve narrow pad escapes beside a wide power span", (): void => {
  const original: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "rail",
    connection_name: "rail",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.8 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.2 },
    ],
  }
  const connMap = new ConnectivityMap({})
  const source = convertPreloadedTraceToHdRoutes(original, 0, 2, 0.45, connMap)
  const before = structuredClone(source)
  const problem = createRegionalFallbackProblem(
    {
      capacityMeshNodeId: "power-region",
      center: { x: 2, y: 0 },
      width: 5,
      height: 2,
      availableZ: [0, 1],
      portPoints: [],
    },
    source,
  )
  const replacements = [
    ...problem.fixedRouteSectionsByConnectionName.values(),
  ].map((section) => {
    const first = section.sourceRoutes[0]!
    const start = section.start.point,
      end = section.end.point
    return spliceFixedRouteSectionWithMutationMask({
      section,
      replacement: {
        ...first,
        route: [start, { x: (start.x + end.x) / 2, y: 0.25, z: 0 }, end],
      },
      sourceMutationMasks: new Map(),
      replacementIsMutated: true,
    })
  })
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: replacements.map((r) => r.route),
    regionalMutationMasks: new Map(
      replacements.map((r) => [r.route.connectionName, r.mutatedSegments]),
    ),
  })
  const updated = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: prepared.sections.map((s) => s.hdRoute),
  })
  const rebuilt = applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: [original],
    originalFixedRoutes: source,
    updatedFixedRoutes: updated,
    replacedConnectionNames: new Set(source.map((r) => r.connectionName)),
    layerCount: 2,
    defaultViaHoleDiameter: 0.2,
    obstacles: [],
    connMap,
  }).updatedPreloadedTraces[0]!
  expect(source).toEqual(before)
  expect(rebuilt.route).toEqual([
    original.route[0]!,
    { route_type: "wire", x: 0.5, y: 0.25, layer: "top", width: 0.2 },
    original.route[1]!,
    { route_type: "wire", x: 2, y: 0.25, layer: "top", width: 0.8 },
    original.route[2]!,
    { route_type: "wire", x: 3.5, y: 0.25, layer: "top", width: 0.2 },
    original.route[3]!,
  ])
})
