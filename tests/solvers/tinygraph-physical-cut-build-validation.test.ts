import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { CapacityMeshNode } from "lib/types"

test("graph construction rejects malformed explicit physical-cut metadata while preserving legacy absence", (): void => {
  const capacityMeshNodes: CapacityMeshNode[] = [-1, 1].map(
    (x, index): CapacityMeshNode => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    }),
  )
  const port: SegmentPortPoint = {
    segmentPortPointId: "boundary-site",
    x: 0,
    y: 0,
    availableZ: [0],
    nodeIds: ["node-0", "node-1"],
    edgeId: "shared-edge",
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
  }
  const params = {
    capacityMeshNodes,
    segmentPortPoints: [port],
    layerCount: 1,
    connectivityMap: new ConnectivityMap({}),
    simpleRouteJsonConnections: [],
  }
  for (const physicalCutId of [null, false, 12, "", "\t", {}, []]) {
    const malformed = { ...port, physicalCutId } as unknown as SegmentPortPoint
    expect((): void => {
      buildHyperGraph({ ...params, segmentPortPoints: [malformed] })
    }).toThrow('Invalid physicalCutId for port "boundary-site"')
  }
  const { graph } = buildHyperGraph(params)
  expect(graph.ports).toHaveLength(1)
  expect(graph.ports[0]!.d.physicalCutId).toBeUndefined()
  expect("physicalCutId" in graph.ports[0]!.d).toBeFalse()
  expect("physicalCutId" in port).toBeFalse()
})
