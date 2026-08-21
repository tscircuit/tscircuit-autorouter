import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver";
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types";

test("buildHyperGraph resolves connection IDs through the connectivity map", (): void => {
  const connectivityMap = new ConnectivityMap({});
  connectivityMap.addConnections([["route-a", "alias-a", "alias-b"]]);
  const netId = connectivityMap.getNetConnectedToId("route-a")!;
  const capacityNode: CapacityMeshNode = {
    capacityMeshNodeId: "node-a",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layer: "z0",
    availableZ: [0],
    _containsTarget: true,
    _connectedTo: ["alias-a", "alias-b", "alias-a"],
  };
  const connection: SimpleRouteConnection = {
    name: "route-a",
    pointsToConnect: [
      { x: -0.5, y: 0, layer: "top" },
      { x: 0.5, y: 0, layer: "top" },
    ],
  };

  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: [capacityNode],
    segmentPortPoints: [],
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections: [connection],
  });

  expect(connections[0]!.mutuallyConnectedNetworkId).toBe(netId);
  expect(graph.regions[0]!.d._connectedTo).toEqual([netId]);
  expect(graph.regions[0]!.d).not.toBe(capacityNode);
  expect(capacityNode._connectedTo).toEqual(["alias-a", "alias-b", "alias-a"]);
  expect(() =>
    buildHyperGraph({
      capacityMeshNodes: [capacityNode],
      segmentPortPoints: [],
      layerCount: 1,
      connectivityMap: new ConnectivityMap({}),
      simpleRouteJsonConnections: [connection],
    }),
  ).toThrow('Could not resolve net ID for connection "alias-a"');
});
