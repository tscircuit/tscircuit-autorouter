import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

export type ForceImproveThroughObstacleRoundingRepro = {
  node: NodeWithPortPoints
  obstacle: Obstacle
  inputRoute: HighDensityRoute
  outputRoute: HighDensityRoute
}

export function createForceImproveThroughObstacleRoundingRepro(): ForceImproveThroughObstacleRoundingRepro {
  // The left edge is -0.2245368 mm, which 0.001 mm output rounding moves
  // outward to -0.225 mm.
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "edge-via-node",
    center: { x: 0.0004632, y: 0 },
    width: 0.45,
    height: 0.45,
    portPoints: [
      { x: -0.2245368, y: 0, z: 1, connectionName: "V3V3" },
      { x: 0.005, y: 0, z: 0, connectionName: "V3V3" },
    ],
    availableZ: [0, 1],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: node.center,
    width: node.width,
    height: node.height,
    layers: ["top", "bottom"],
    connectedTo: ["V3V3"],
  }
  const transitionSolver = new SingleTransitionThroughObstacleIntraNodeSolver({
    nodeWithPortPoints: node,
    obstacles: [obstacle],
    connMap: new ConnectivityMap({ V3V3: ["V3V3"] }),
    layerCount: 2,
    viaDiameter: 0.45,
    traceThickness: 0.15,
  })
  const inputRoute = transitionSolver.solvedRoutes[0]
  if (!inputRoute) {
    throw new Error("Expected the edge transition solver to produce a route")
  }
  const forceImproveSolver = new HighDensityForceImproveSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [inputRoute],
    totalStepsPerNode: 12,
    nodeAssignmentMargin: 0.2,
  })
  forceImproveSolver.solve()
  const outputRoute = forceImproveSolver.getOutput()[0]
  if (!outputRoute) {
    throw new Error("Expected force improvement to return the input route")
  }

  return {
    node,
    obstacle,
    inputRoute,
    outputRoute,
  }
}
