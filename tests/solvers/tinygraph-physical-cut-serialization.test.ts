import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode } from "lib/types"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("finite physical-cut provenance survives layer expansion and native serialization without changing source geometry", (): void => {
  const capacityMeshNodes: CapacityMeshNode[] = [-1, 1].map(
    (x, index): CapacityMeshNode => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0, 1],
    }),
  )
  const segmentPortPoints: SegmentPortPoint[] = [-0.25, 0.25].map(
    (y, index): SegmentPortPoint => ({
      segmentPortPointId: `site-${index}`,
      x: 0,
      y,
      availableZ: [0, 1],
      nodeIds: ["node-0", "node-1"],
      edgeId: "shared-edge",
      connectionName: null,
      distToCentermostPortOnZ: 0.25,
      cramped: false,
      physicalCutId: "shared-edge-cut",
    }),
  )
  const nodesBefore = structuredClone(capacityMeshNodes)
  const portsBefore = structuredClone(segmentPortPoints)
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["route-a", "net-a"]])
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    layerCount: 2,
    connectivityMap,
    simpleRouteJsonConnections: [
      {
        name: "route-a",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  })
  expect(graph.ports).toHaveLength(4)
  for (const port of graph.ports) {
    expect(port.d.physicalCutId).toBe("shared-edge-cut")
    expect(port.d.z === 0 || port.d.z === 1).toBeTrue()
  }
  const graphBefore = structuredClone(graph)
  const wrapper = new TinyHypergraphPortPointPathingSolver({
    ...createPhysicalWrapperProblem(),
    graph,
    connections,
    layerCount: 2,
  })
  const serializedGraph =
    wrapper["tinyPipelineSolver"].inputProblem.serializedHyperGraph
  const roundTrip: SerializedHyperGraph = JSON.parse(
    JSON.stringify(serializedGraph),
  )
  const { topology } = loadSerializedHyperGraph(roundTrip)
  for (const sourcePort of graph.ports) {
    const serializedPort = serializedGraph.ports.find(
      (port): boolean => port.portId === sourcePort.d.portId,
    )
    expect(serializedPort?.d?.physicalCutId).toBe("shared-edge-cut")
    expect(serializedPort?.d?.z).toBe(sourcePort.d.z)
    const nativePort = topology.portMetadata?.find(
      (metadata): boolean => metadata.serializedPortId === sourcePort.d.portId,
    )
    expect(nativePort?.physicalCutId).toBe("shared-edge-cut")
    expect(nativePort?.x).toBe(sourcePort.d.x)
    expect(nativePort?.y).toBe(sourcePort.d.y)
    expect(nativePort?.z).toBe(sourcePort.d.z)
  }
  expect(graph).toEqual(graphBefore)
  expect(capacityMeshNodes).toEqual(nodesBefore)
  expect(segmentPortPoints).toEqual(portsBefore)
})
