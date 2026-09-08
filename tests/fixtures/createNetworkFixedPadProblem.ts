import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9FixedPadClearance,
  type Pipeline9FixedPadClearance,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export const createNetworkFixedPadProblem = (): {
  node: NodeWithPortPoints
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  fixedPadClearance: Pipeline9FixedPadClearance
} => {
  const connMap = new ConnectivityMap({
    "route-net": ["route", "route-root"],
    "foreign-canonical-net": ["foreign-pad"],
  })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-corner-node",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    portPoints: [
      {
        x: 0.25,
        y: 0,
        z: 0,
        connectionName: "route",
        rootConnectionName: "route-root",
        portPointId: "route-start",
      },
      {
        x: 0,
        y: -0.25,
        z: 0,
        connectionName: "route",
        rootConnectionName: "route-root",
        portPointId: "route-end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0.45, y: -0.45 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["foreign-pad"],
    },
    {
      type: "rect",
      center: { x: 100, y: 100 },
      width: 1,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["foreign-pad"],
    },
  ]
  const fixedPadClearance = createPipeline9FixedPadClearance({
    obstacles,
    connMap,
    layerCount: 2,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.1,
  })
  return { node, connMap, obstacles, fixedPadClearance }
}
