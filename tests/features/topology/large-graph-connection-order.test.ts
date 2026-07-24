import { expect, test } from "bun:test"
import { orderLargeGraphConnections } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

function createConnection(
  connectionId: string,
  mutuallyConnectedNetworkId: string,
  end: { x: number; y: number; layer: string },
) {
  return {
    connectionId,
    mutuallyConnectedNetworkId,
    startRegion: {},
    endRegion: {},
    simpleRouteConnection: {
      name: connectionId,
      pointsToConnect: [{ x: 0, y: 0, layer: "top" }, end],
    },
  }
}

test("orders larger nets first and cross-layer routes first within each net", () => {
  const smallNet = createConnection("small-net", "net-b", {
    x: 0.1,
    y: 0,
    layer: "top",
  })
  const sameLayer = createConnection("same-layer", "net-a", {
    x: 1,
    y: 0,
    layer: "top",
  })
  const crossLayer = createConnection("cross-layer", "net-a", {
    x: 10,
    y: 0,
    layer: "bottom",
  })

  const ordered = orderLargeGraphConnections([
    sameLayer,
    smallNet,
    crossLayer,
  ] as any)

  expect(ordered.map((connection) => connection.connectionId)).toEqual([
    "cross-layer",
    "same-layer",
    "small-net",
  ])
})
