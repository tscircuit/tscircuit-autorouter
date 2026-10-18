import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createSharedCopperNodeRoutingPlan } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createSharedCopperNodeRoutingPlan"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("same-net MST hops share copper without merging foreign nets or ports", (): void => {
  const pair = (
    connectionName: string,
    rootConnectionName: string,
  ): [PortPoint, PortPoint] => [
    {
      connectionName,
      rootConnectionName,
      portPointId: "left",
      x: -1,
      y: 0,
      z: 0,
    },
    {
      connectionName,
      rootConnectionName,
      portPointId: "right",
      x: 1,
      y: 0,
      z: 0,
    },
  ]
  const first = pair("mst-1", "signal")
  const shared = pair("mst-2", "signal-alias")
  shared.reverse()
  const foreign = pair("other-net", "foreign")
  const different = pair("different-hop", "signal")
  different[1] = { ...different[1], portPointId: "middle", x: 0.5 }
  const pairs = [first, shared, foreign, different]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-copper",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: pairs.flat(),
    portPointsInPairs: pairs,
  }
  const inputCopy = structuredClone(node)
  const plan = createSharedCopperNodeRoutingPlan(
    node,
    new ConnectivityMap({ signal: ["signal-alias"] }),
  )

  expect(plan.sharedConnectionCount).toBe(1)
  expect(plan.connectionNamesByRepresentative.get("mst-1")).toEqual([
    "mst-1",
    "mst-2",
  ])
  expect([...plan.connectionNamesByRepresentative.keys()]).toEqual([
    "mst-1",
    "other-net",
    "different-hop",
  ])
  expect(plan.routingNode.portPoints).toHaveLength(6)
  expect(plan.routingNode.portPointsInPairs).toHaveLength(3)
  expect(node).toEqual(inputCopy)
})
