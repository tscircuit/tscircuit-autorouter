import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouter-version"
import {
  Pipeline9NetworkedHighDensitySolver,
  type Pipeline9NetworkedHighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-high-density-solver"
import type {
  Pipeline9NetworkedHighDensityNodeOutput,
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveBatchResult,
  Pipeline9NetworkedSolveResponse,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
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

type NetworkedFixtureNodeOutput =
  | (Omit<
      Extract<
        Pipeline9NetworkedHighDensityNodeOutput,
        { status: "solved"; solutionStage: "ordinary" }
      >,
      "solutionStage"
    > & { solutionStage?: "ordinary" })
  | (Omit<
      Extract<
        Pipeline9NetworkedHighDensityNodeOutput,
        { status: "failed"; solutionStage: "ordinary" }
      >,
      "solutionStage"
    > & { solutionStage?: "ordinary" })
  | Extract<
      Pipeline9NetworkedHighDensityNodeOutput,
      { solutionStage: "regional-fallback" }
    >

export const createNetworkedResponse = (
  response: NetworkedFixtureNodeOutput & {
    autorouterVersion?: string
    source?: "cache" | "solver"
  },
): Response =>
  new Response(
    JSON.stringify({
      ok: true,
      autorouterVersion: response.autorouterVersion ?? AUTOROUTER_VERSION,
      source: response.source ?? "cache",
      solutionStage: response.solutionStage ?? "ordinary",
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
): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).replace(/\/+$/, "").endsWith("/solve-batch")) {
      return implementation(input, init)
    }

    const batchRequest = JSON.parse(
      String(init?.body),
    ) as Pipeline9NetworkedSolveBatchRequest
    const resultLines = await Promise.all(
      batchRequest.items.map(async (item) => {
        const response = await implementation(
          String(input).replace(/\/solve-batch\/?$/, "/solve"),
          {
            ...init,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              autorouterVersion: batchRequest.autorouterVersion,
              input: item.input,
            }),
          },
        )
        const responseText = await response.text()
        let responseBody: Pipeline9NetworkedSolveResponse
        try {
          responseBody = JSON.parse(responseText)
        } catch {
          responseBody = {
            ok: false,
            message: `Invalid fixture response with status ${response.status}`,
          }
        }
        if (!response.ok && responseBody.ok !== false) {
          responseBody = {
            ok: false,
            message: `Fixture request failed with status ${response.status}`,
          }
        }
        return JSON.stringify({ requestId: item.requestId, ...responseBody })
      }),
    )
    return new Response(`${resultLines.join("\n")}\n`, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    })
  }) as unknown as typeof fetch

export const asNetworkedBatchFetch = (
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch => implementation as unknown as typeof fetch

export const createNetworkedBatchStream = (): {
  response: Response
  write: (result: Pipeline9NetworkedSolveBatchResult | object) => void
  close: () => void
} => {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    }),
    write: (result) => {
      const responseResult = result as Record<string, unknown>
      const serializedResult =
        responseResult.ok === true && responseResult.solutionStage === undefined
          ? { solutionStage: "ordinary", ...responseResult }
          : responseResult
      controller.enqueue(
        encoder.encode(`${JSON.stringify(serializedResult)}\n`),
      )
    },
    close: () => controller.close(),
  }
}

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
  maxBatchItems,
  maxBatchBodyBytes,
  enableRegionalFallback = false,
  preserveTerminalPcbPortIds = true,
}: {
  nodes: NodeWithPortPoints[]
  fetchImpl: typeof fetch
  fixedHdRoutes?: PreloadedHighDensityRoute[]
  requestTimeoutMs?: number
  transportTimeoutMs?: number
  maxBatchItems?: number
  maxBatchBodyBytes?: number
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
    maxBatchItems,
    maxBatchBodyBytes,
  }
  return new Pipeline9NetworkedHighDensitySolver(params)
}
