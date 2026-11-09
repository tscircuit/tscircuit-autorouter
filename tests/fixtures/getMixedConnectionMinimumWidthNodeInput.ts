import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

export const getMixedConnectionMinimumWidthNodeInput =
  (): Pipeline9HighDensitySolverParams => ({
    nodePortPoints: [
      {
        capacityMeshNodeId: "mixed-width-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 2,
        availableZ: [0],
        portPoints: [
          { connectionName: "POWER", x: -2, y: -0.2, z: 0 },
          { connectionName: "POWER", x: 2, y: -0.2, z: 0 },
          { connectionName: "SIGNAL", x: -2, y: 0.2, z: 0 },
          { connectionName: "SIGNAL", x: 2, y: 0.2, z: 0 },
        ],
      },
    ],
    connections: [{ name: "POWER", minTraceWidth: 0.4, pointsToConnect: [] }],
    connMap: new ConnectivityMap({
      power: ["POWER"],
      signal: ["SIGNAL"],
      fixed: ["FIXED"],
    }),
    fixedHdRoutes: [],
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
  })
