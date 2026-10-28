import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("regional copper costs retain exact certified geometry without turning user preloads into fixed interiors", () => {
  const { graph, srj, netId } = createImmutableCopperRegionsFixture()
  srj.traces!.push({ type: "pcb_trace", pcb_trace_id: "pipeline9_forest_user-name", connection_name: "A", route: [
    { route_type: "wire", x: -2, y: 0.5, layer: "top", width: 0.9 },
    { route_type: "wire", x: 2, y: 0.5, layer: "top", width: 0.9 },
  ] })
  const connectionsBefore = structuredClone(graph.connections)
  const tracesBefore = structuredClone(srj.traces)
  const stats = annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(stats).toEqual({ regions: 1, segmentAssociations: 1 })
  expect(graph.regions[0]!.d!.fixedCopperSegments).toEqual([
    { netId, x1: -2, y1: 0, x2: 2, y2: 0, z: 0, width: 0.2, clearance: 0.1 },
  ])
  expect(graph.regions[0]!.d!.fixedCopperTraceWidth).toBe(0.1)
  expect(graph.regions[1]!.d!.fixedCopperSegments).toBeUndefined()
  expect(graph.regions[2]!.d!.fixedCopperSegments).toBeUndefined()
  expect(graph.connections).toEqual(connectionsBefore)
  expect(srj.traces).toEqual(tracesBefore)
  expect(graph.solvedRoutes).toEqual([])
})
