import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9CanonicalPortNetIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9CanonicalPortNetIds"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 generated connection aliases resolve one recorded net without inventing ownership", (): void => {
  const connMap = new ConnectivityMap({
    "first-net": ["first-route", "first-root"],
    "second-net": ["second-route"],
  })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    portPoints: [
      {
        x: 0,
        y: 0,
        z: 0,
        connectionName: "generated-section",
        rootConnectionName: "first-net",
      },
    ],
  }
  expect(
    getPipeline9CanonicalPortNetIds([node], connMap).get("generated-section"),
  ).toBe("first-net")
  node.portPoints[0].connectionName = "first-route"
  node.portPoints[0].rootConnectionName = "second-route"
  expect((): void => {
    getPipeline9CanonicalPortNetIds([node], connMap)
  }).toThrow("requires one known electrical net")
  node.portPoints[0].rootConnectionName = undefined
  node.portPoints[0].connectionName = "unknown"
  expect((): void => {
    getPipeline9CanonicalPortNetIds([node], connMap)
  }).toThrow("requires one known electrical net")
})
