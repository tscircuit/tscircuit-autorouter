import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import {
  Pipeline9NetworkedHighDensitySolver,
  type Pipeline9NetworkedHighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export const createNetworkedNode = ({
  nodeId,
  connectionName,
  rootConnectionName = `root_${connectionName}`,
  xOffset = 0,
}: {
  nodeId: string
  connectionName: string
  rootConnectionName?: string
  xOffset?: number
}): NodeWithPortPoints => ({
  capacityMeshNodeId: nodeId,
  center: { x: xOffset, y: 0 },
  width: 4,
  height: 4,
  availableZ: [0, 1],
  portPoints: [
    {
      x: xOffset - 2,
      y: 0,
      z: 0,
      connectionName,
      rootConnectionName,
      pcb_port_id: `${nodeId}_start`,
    },
    {
      x: xOffset + 2,
      y: 0,
      z: 0,
      connectionName,
      rootConnectionName,
      pcb_port_id: `${nodeId}_end`,
    },
  ],
})

export const createNetworkedCrossingNode = ({
  nodeId,
}: {
  nodeId: string
}): NodeWithPortPoints => {
  const portPoints: NodeWithPortPoints["portPoints"] = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  return {
    capacityMeshNodeId: nodeId,
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
}

export const createNetworkedFixedRoute = (): PreloadedHighDensityRoute => ({
  connectionName: "fixed_foreign",
  rootConnectionName: "root_fixed_foreign",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: -2, z: 0 },
    { x: 0, y: 2, z: 0 },
  ],
  vias: [],
  preloadedTraceIndex: 0,
  preloadedRouteIndex: 0,
})

export const createDeferred = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export const createNetworkedHighDensitySolver = ({
  nodes,
  hdCache2ServerUrl,
  hdCache2CacheVersion,
  fixedHdRoutes = [],
  obstacles = [],
  requestTimeoutMs = 1_000,
  enableRegionalFallback = false,
  preserveTerminalPcbPortIds = true,
  layerCount = 2,
  traceWidth = 0.15,
}: {
  nodes: NodeWithPortPoints[]
  hdCache2ServerUrl: string
  hdCache2CacheVersion?: string
  fixedHdRoutes?: PreloadedHighDensityRoute[]
  obstacles?: Obstacle[]
  requestTimeoutMs?: number
  enableRegionalFallback?: boolean
  preserveTerminalPcbPortIds?: boolean
  layerCount?: number
  traceWidth?: number
}): Pipeline9NetworkedHighDensitySolver => {
  const connectivityNetMap: Record<string, string[]> = {
    root_fixed_foreign: ["root_fixed_foreign", "fixed_foreign"],
  }
  for (const node of nodes) {
    for (const point of node.portPoints) {
      const root = point.rootConnectionName ?? point.connectionName
      connectivityNetMap[root] ??= [root]
      if (!connectivityNetMap[root]!.includes(point.connectionName)) {
        connectivityNetMap[root]!.push(point.connectionName)
      }
    }
  }

  const params: Pipeline9NetworkedHighDensitySolverParams = {
    nodePortPoints: nodes,
    fixedHdRoutes,
    connMap: new ConnectivityMap(connectivityNetMap),
    colorMap: Object.fromEntries(
      nodes.flatMap((node) =>
        node.portPoints.map((point) => [point.connectionName, "blue"]),
      ),
    ),
    obstacles,
    layerCount,
    viaDiameter: 0.3,
    traceWidth,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map(nodes.map((node) => [node.capacityMeshNodeId, 0.1])),
    preserveTerminalPcbPortIds,
    enableRegionalFallback,
    autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl,
    hdCache2CacheVersion,
    requestTimeoutMs,
  }
  return new Pipeline9NetworkedHighDensitySolver(params)
}

export const solveNetworkedHighDensitySolver = async (
  solver: Pipeline9NetworkedHighDensitySolver,
): Promise<void> => {
  while (!solver.solved && !solver.failed) {
    solver.step()
    const pendingEffects = solver.pendingEffects ?? []
    if (pendingEffects.length > 0) {
      await Promise.race(
        pendingEffects.map((effect) => effect.promise.catch(() => undefined)),
      )
    }
  }
}
