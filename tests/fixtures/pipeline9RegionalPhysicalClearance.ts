import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type RegionalPhysicalProblem = {
  node: NodeWithPortPoints
  pair: [PortPoint, PortPoint]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  canonicalTargetNetId: string
  params: ConstructorParameters<typeof Pipeline9RegionalFallbackSolver>[0]
}

export function createPipeline9RegionalPhysicalProblem(): RegionalPhysicalProblem {
  const pair: [PortPoint, PortPoint] = [
    {
      x: 1,
      y: -2,
      z: 0,
      portPointId: "target-start",
      pcb_port_id: "pcb-target-start",
      nextPortPointId: "target-end",
      connectionName: "local-target",
      rootConnectionName: "target-root",
    },
    {
      x: 5,
      y: -2,
      z: 0,
      portPointId: "target-end",
      pcb_port_id: "pcb-target-end",
      prevPortPointId: "target-start",
      connectionName: "local-target",
      rootConnectionName: "target-root",
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "regional-physical-node",
    center: { x: 3, y: -2 },
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: structuredClone(pair),
    portPointsInPairs: [structuredClone(pair)],
  }
  const connMap = new ConnectivityMap({
    "target-root": [
      "target-root",
      "target-source",
      "pcb-target-start",
      "pcb-target-end",
    ],
    "foreign-root": ["foreign-root", "foreign-pad"],
    "preload-root": ["preload-root", "preload-source"],
  })
  const canonicalTargetNetId = connMap.getNetConnectedToId("target-source")
  if (canonicalTargetNetId === undefined) {
    throw new Error("Regional physical fixture requires its canonical net")
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 3, y: -2 },
      width: 0.5,
      height: 1,
      layers: ["top"],
      connectedTo: ["foreign-pad"],
    },
    ...pair.map(
      (point): Obstacle => ({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [point.pcb_port_id!],
      }),
    ),
  ]
  const fixedPadClearance = createPipeline9FixedPadClearance({
    obstacles,
    connMap,
    layerCount: 2,
    traceToPadClearance: 0.125,
    viaToPadClearance: 0.1875,
  })
  return {
    node,
    pair,
    obstacles,
    connMap,
    canonicalTargetNetId,
    params: {
      nodeWithPortPoints: node,
      connMap,
      obstacles,
      boardObstacles: obstacles,
      movablePreloadedConnectionNames: new Set(),
      viaToPadClearance: 0.1875,
      layerCount: 2,
      traceWidth: 0.125,
      viaDiameter: 0.25,
      obstacleMargin: 0.15,
      effort: 1,
      colorMap: {},
      fixedPadClearance,
    },
  }
}
