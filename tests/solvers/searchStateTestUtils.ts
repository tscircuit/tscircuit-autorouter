import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export function searchStateNode(x: number, y: number, parent: Node | null = null): Node {
  return {
    x, y, z: 0,
    g: 0, h: 0, f: 0,
    parent,
  }
}

export function searchStateParams(): ConstructorParameters<
  typeof SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
>[0] {
  return {
    connectionName: "target",
    bounds: { minX: 0, maxX: 2.5, minY: 0, maxY: 2.5 },
    A: { x: 0.8, y: 0.8, z: 0 },
    B: { x: 2, y: 2, z: 0 },
    minDistBetweenEnteringPoints: 2,
    obstacleRoutes: [{
      connectionName: "obstacle",
      route: [{ x: 0.85, y: 1.135, z: 0 }, { x: 0.86, y: 1.145, z: 0 }],
      vias: [],
      traceThickness: 0.15,
      viaDiameter: 0.3,
    }],
    captureSearchDebug: false,
    hyperParameters: {},
    availableZ: [0],
    futureConnections: [],
  }
}

export function searchStateFactoryNode(): NodeWithPortPoints {
  return {
    capacityMeshNodeId: "search-state-test",
    center: { x: 0, y: 0 },
    width: 6, height: 6,
    availableZ: [0, 1],
    portPoints: [
      { x: -2.8, y: 0, z: 0, connectionName: "a" },
      { x: 2.8, y: 0, z: 0, connectionName: "a" },
      { x: 0, y: -2.8, z: 0, connectionName: "b" },
      { x: 0, y: 1.1, z: 0, connectionName: "b" },
      { x: 1.5, y: 2.2, z: 0, connectionName: "c" },
      { x: 2.7, y: 2.2, z: 0, connectionName: "c" },
    ],
  }
}
