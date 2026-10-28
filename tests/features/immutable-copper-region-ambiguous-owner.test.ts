import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("coincident and rounded coarse aliases never exempt a distinct physical owner from fixed-copper costs", () => {
  const { graph, srj } = createImmutableCopperRegionsFixture()
  srj.connections.push({ name: "B", pointsToConnect: [
    { x: -2.001, y: 0, layer: "top", pcb_port_id: "B-start" },
    { x: 2.001, y: 0, layer: "top", pcb_port_id: "B-end" },
  ] })
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const coarseNet = connMap.getNetConnectedToId("A")!
  expect(coarseNet).toBe(connMap.getNetConnectedToId("B")!)
  graph.connections![0]!.mutuallyConnectedNetworkId = coarseNet
  annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments).toHaveLength(1)
  expect(graph.regions[0]!.d!.fixedCopperSegments[0].netId).toBeNull()
})
