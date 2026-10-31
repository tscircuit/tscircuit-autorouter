import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { scopedClearanceFixture } from "./fixtures/scoped-clearance"

test("merged connection aliases preserve every net selector and missing identities are rejected", () => {
  const { srj } = scopedClearanceFixture("top")
  srj.connections[1]!.pointsToConnect[0] = {
    ...srj.connections[0]!.pointsToConnect[1]!,
  }
  srj.connections = mergeConnections(srj.connections)
  expect(srj.connections).toHaveLength(1)
  expect(srj.connections[0]!.sourceNetIds).toEqual([
    "source_net_earth",
    "source_net_signal",
  ])
  const map = getConnectivityMapFromSimpleRouteJson(srj)
  expect(
    map.areIdsConnected(srj.connections[0]!.name, "source_net_earth"),
  ).toBe(true)
  expect(
    map.areIdsConnected(srj.connections[0]!.name, "source_net_signal"),
  ).toBe(true)
  delete srj.connections[0]!.sourceNetIds
  expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)).toThrow(
    "original net identities",
  )
})
