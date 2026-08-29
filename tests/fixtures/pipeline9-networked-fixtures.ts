import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouter-version"
import {
  Pipeline9NetworkedHighDensitySolver,
  type Pipeline9NetworkedHighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-high-density-solver"
import type { Pipeline9NetworkedHighDensityNodeOutput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

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

export const createNetworkedRoute = (
  node: NodeWithPortPoints,
): HighDensityIntraNodeRoute => ({
  connectionName: node.portPoints[0]!.connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: node.portPoints.map(({ x, y, z }) => ({ x, y, z })),
  vias: [],
})

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

export const createNetworkedResponse = (
  response: Pipeline9NetworkedHighDensityNodeOutput & {
    autorouterVersion?: string
    source?: "cache" | "solver"
  },
): Response =>
  new Response(
    JSON.stringify({
      ok: true,
      autorouterVersion: response.autorouterVersion ?? AUTOROUTER_VERSION,
      source: response.source ?? "cache",
      ...response,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  )

export const asNetworkedFetch = (
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch => implementation as unknown as typeof fetch

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
  fetchImpl,
  fixedHdRoutes = [],
  requestTimeoutMs = 1_000,
  transportTimeoutMs,
  enableRegionalFallback = false,
  preserveTerminalPcbPortIds = true,
}: {
  nodes: NodeWithPortPoints[]
  fetchImpl: typeof fetch
  fixedHdRoutes?: PreloadedHighDensityRoute[]
  requestTimeoutMs?: number
  transportTimeoutMs?: number
  enableRegionalFallback?: boolean
  preserveTerminalPcbPortIds?: boolean
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
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map(nodes.map((node) => [node.capacityMeshNodeId, 0.1])),
    preserveTerminalPcbPortIds,
    enableRegionalFallback,
    autorouterVersion: AUTOROUTER_VERSION,
    fetchImpl,
    requestTimeoutMs,
    transportTimeoutMs,
  }
  return new Pipeline9NetworkedHighDensitySolver(params)
}
