import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

export type Pipeline9NetworkedForceFixture = {
  nodes: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
}

export function createPipeline9NetworkedForceFixture(): Pipeline9NetworkedForceFixture {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "signal_a",
      rootConnectionName: "normalized_a",
      regionId: "node_a",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -2.000123, y: 0, z: 0 },
        { x: -1.2, y: 0, z: 0 },
        { x: -0.4, y: 0.2, z: 1 },
        { x: 0.4, y: 0.2, z: 1 },
        { x: 1.2, y: 0, z: 0 },
        { x: 2.000123, y: 0, z: 0 },
      ],
      vias: [
        { x: -0.4, y: 0.2 },
        { x: 0.4, y: 0.2 },
      ],
    },
    {
      connectionName: "signal_b",
      rootConnectionName: "normalized_b",
      regionId: "node_b",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 8, y: -0.1, z: 0 },
        { x: 8.8, y: -0.1, z: 0 },
        { x: 9.5, y: 0.15, z: 0 },
        { x: 10.5, y: 0.15, z: 0 },
        { x: 11.2, y: -0.1, z: 0 },
        { x: 12, y: -0.1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "neighbor_a",
      rootConnectionName: "normalized_neighbor",
      regionId: "node_a",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.3, z: 0 },
        { x: -1.2, y: 0.3, z: 0 },
        { x: -0.4, y: 0.3, z: 0 },
        { x: 0.4, y: 0.3, z: 0 },
        { x: 1.2, y: 0.3, z: 0 },
        { x: 2, y: 0.3, z: 0 },
      ],
      vias: [],
    },
  ]
  const nodes: NodeWithPortPoints[] = [0, 1].map((index) => ({
    capacityMeshNodeId: index === 0 ? "node_a" : "node_b",
    center: { x: index * 10, y: 0 },
    width: 6,
    height: 4,
    availableZ: [0, 1],
    portPoints: routes
      .filter((route) => route.regionId === (index === 0 ? "node_a" : "node_b"))
      .flatMap((route) =>
        [route.route[0]!, route.route.at(-1)!].map((point, endpointIndex) => ({
          ...point,
          connectionName: route.connectionName,
          rootConnectionName: `original_${route.connectionName}`,
          pcb_port_id: `${route.connectionName}_port_${endpointIndex}`,
        })),
      ),
  }))
  return { nodes, routes }
}
