import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createSharedCopperNodeRoutingPlan } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createSharedCopperNodeRoutingPlan"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("shared MST copper preserves the pairings of a revisited region", (): void => {
  const pairs: [PortPoint, PortPoint][] = []
  for (const name of ["first", "shared", "different-pairing"]) {
    const points: PortPoint[] = [0, 5].flatMap((z) =>
      [-1, 1].map((x) => ({
        connectionName: name,
        rootConnectionName: "signal",
        portPointId: `${x}:${z}`,
        x,
        y: 0,
        z,
      })),
    )
    if (name === "different-pairing") {
      pairs.push([points[0]!, points[2]!], [points[1]!, points[3]!])
    } else {
      pairs.push([points[0]!, points[1]!], [points[2]!, points[3]!])
    }
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "revisited-region",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1, 2, 3, 4, 5],
    portPoints: pairs.flat(),
    portPointsInPairs: pairs,
  }
  const plan = createSharedCopperNodeRoutingPlan(node, new ConnectivityMap({}))
  expect(plan.sharedConnectionCount).toBe(1)
  expect(plan.connectionNamesByRepresentative.get("first")).toEqual([
    "first",
    "shared",
  ])
  expect(plan.connectionNamesByRepresentative.has("different-pairing")).toBe(
    true,
  )
  expect(plan.routingNode.portPointsInPairs).toHaveLength(4)
})
