import type { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"

export function createHighDensityRepairRuntimeFixture(): ConstructorParameters<
  typeof Pipeline4HighDensityRepairSolver
>[0] {
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    capacityMeshNodeId: `repair-node-${index}`,
    center: { x: index * 2.2, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }))
  return {
    nodeWithPortPoints: nodes,
    minimumTraceWidth: 0.2,
    hdRoutes: nodes.flatMap((node, index) => [-0.1, 0.1].map((y, side) => ({
      regionId: node.capacityMeshNodeId,
      connectionName: `repair-route-${index}-${side}`,
      rootConnectionName: `repair-net-${index}-${side}`,
      startPcbPortId: `start-${index}-${side}`,
      endPcbPortId: `end-${index}-${side}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-1, 0, 1].map((x) => ({ x: node.center.x + x, y, z: 0 })),
    }))),
    obstacles: nodes.map((node) => ({
      type: "rect" as const,
      center: { x: node.center.x + 0.2, y: 0.45 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    })),
  }
}
