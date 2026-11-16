import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreloadedPortValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreloadedPortValidator"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("shared crossings preserve clearance from preloaded copper on every layer", (): void => {
  for (const { layerCount, z, layer } of [
    { layerCount: 2, z: 0, layer: "top" },
    { layerCount: 2, z: 1, layer: "bottom" },
    { layerCount: 4, z: 0, layer: "top" },
    { layerCount: 4, z: 1, layer: "inner1" },
    { layerCount: 4, z: 2, layer: "inner2" },
    { layerCount: 4, z: 3, layer: "bottom" },
  ]) {
    const otherZ = (z + 1) % layerCount
    const srj: SimpleRouteJson = {
      layerCount,
      minTraceWidth: 0.08,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: 0, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [],
      connections: [],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "ddr",
          connection_name: "ddr",
          route: [
            { route_type: "wire", x: 0.64, y: -1, width: 0.08, layer },
            { route_type: "wire", x: 0.64, y: 1, width: 0.08, layer },
          ],
        },
      ],
    }
    const isPortPointClear = createPreloadedPortValidator({
      srj,
      connMap: new ConnectivityMap({}),
      traceWidth: srj.minTraceWidth,
      viaDiameter: 0.35,
    })
    const ports: PortPoint[] = [z, otherZ].flatMap((z) => [
      { portPointId: `left-${z}`, connectionName: "a", x: 1.6, y: 0, z },
      { portPointId: `right-${z}`, connectionName: "b", x: 1.8, y: 0, z },
    ])
    const nodes: NodeWithPortPoints[] = [-1, 1].map((y, index) => ({
      capacityMeshNodeId: index === 0 ? "lower" : "upper",
      center: { x: 1, y },
      width: 2,
      height: 2,
      availableZ: [z, otherZ],
      portPoints: ports.map((port) => ({ ...port })),
      portPointsInPairs: [[{ ...ports[0]! }, { ...ports[1]! }]],
    }))
    const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
      ...node,
      availableZ: [z, otherZ],
      portPoints: ports.map((port) => ({
        ...port,
        portPointId: port.portPointId!,
        connectionNodeIds: ["lower", "upper"],
        distToCentermostPortOnZ: 0,
      })),
    }))
    const solver = new UniformPortDistributionSolver({
      nodeWithPortPoints: nodes,
      inputNodesWithPortPoints: inputNodes,
      obstacles: [],
      layerCount,
      useLayerAwareGeometry: true,
      preserveSolitaryPorts: true,
      isPortPointClear,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(isPortPointClear({ ...ports[0]!, x: 0.5 })).toBeFalse()
    expect(
      isPortPointClear({ ...ports[0]!, x: 0.5, connectionName: "ddr" }),
    ).toBeTrue()
    for (const node of solver.getOutput()) {
      expect(node.portPoints.every(isPortPointClear)).toBeTrue()
      expect(
        node.portPoints
          .filter((point) => point.z === z)
          .map((point) => point.x),
      ).toEqual([1.6, 1.8])
      expect(
        node.portPoints
          .filter((point) => point.z === otherZ)
          .map((point) => point.x),
      ).toEqual([0.5, 1.5])
      expect(node.portPointsInPairs![0]!.map((point) => point.x)).toEqual([
        1.6, 1.8,
      ])
    }
    expect(nodes[0]!.portPoints[2]!.x).toBe(1.6)
  }
})
