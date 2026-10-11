import {
  getLocalHighDensityCacheKey,
  normalizeLocalHighDensityJson,
  parseLocalHighDensityRequest,
  type LocalHighDensityObject,
  type LocalHighDensityRequest,
  type LocalHighDensityServerStats,
} from "./localHighDensityProtocol"

type LocalHighDensityServerOptions = {
  autorouterVersion: string
  solve: (
    input: LocalHighDensityObject,
  ) => LocalHighDensityObject | Promise<LocalHighDensityObject>
  onFault: (error: Error) => void
}
export type LocalHighDensityServer = {
  fetch: (request: Request) => Promise<Response>
  stats: LocalHighDensityServerStats
}

/** Geometry remains the checkout client's responsibility; terminal metadata cannot. */
function assertLocalHighDensityTerminalResult(
  value: unknown,
  input: LocalHighDensityObject,
): asserts value is LocalHighDensityObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "Local high-density helper returned an invalid terminal result",
    )
  }
  const output = value as Record<string, unknown>
  for (const field of [
    "ok",
    "source",
    "autorouterVersion",
    "cacheVersion",
    "requestId",
  ]) {
    if (Object.prototype.hasOwnProperty.call(output, field)) {
      throw new TypeError(
        `Local high-density helper returned a server-owned field: ${field}`,
      )
    }
  }
  const stage = output.solutionStage
  if (
    (output.status !== "solved" && output.status !== "failed") ||
    (stage !== "ordinary" &&
      stage !== "regional-fallback" &&
      stage !== "repair")
  ) {
    throw new TypeError(
      "Local high-density helper returned an invalid terminal status or stage",
    )
  }
  if (
    (input.solvePolicy === "high_density_repair_v1" && stage !== "repair") ||
    (input.solvePolicy === "ordinary_then_regional_without_fixed_copper_v1" &&
      stage === "repair")
  ) {
    throw new TypeError(
      "Local high-density helper returned a stage for a different solve policy",
    )
  }
  if (
    stage === "ordinary" &&
    Object.prototype.hasOwnProperty.call(output, "ordinaryFailure")
  ) {
    throw new TypeError(
      "Local high-density ordinary result cannot contain ordinaryFailure",
    )
  }
  if (
    stage === "regional-fallback" &&
    (input.enableRegionalFallback !== true ||
      typeof output.ordinaryFailure !== "string" ||
      output.ordinaryFailure.trim().length === 0)
  ) {
    throw new TypeError(
      "Local high-density regional result requires enabled repair and ordinaryFailure",
    )
  }
  if (output.status === "failed") {
    if (typeof output.error !== "string" || output.error.trim().length === 0) {
      throw new TypeError(
        "Local high-density failed result requires a nonempty error",
      )
    }
    if (stage === "ordinary" && input.enableRegionalFallback === true) {
      throw new TypeError(
        "Local high-density ordinary failure did not complete enabled regional repair",
      )
    }
  } else if (
    !Array.isArray(stage === "repair" ? output.repairedRoutes : output.routes)
  ) {
    throw new TypeError(
      "Local high-density solved result requires a route array",
    )
  }
}

/** One process computes one job at a time; only this exact HTTP cache persists. */
export function createLocalHighDensityServer(
  options: LocalHighDensityServerOptions,
): LocalHighDensityServer {
  const cache = new Map<string, LocalHighDensityObject>()
  const inFlight = new Map<string, Promise<LocalHighDensityObject>>()
  let previousSolve: Promise<void> = Promise.resolve()
  const stats: LocalHighDensityServerStats = {
    solveRequests: 0,
    batchRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    jobsComputed: 0,
    computeMs: 0,
  }
  const identity = (cacheVersion?: string): LocalHighDensityObject => ({
    autorouterVersion: options.autorouterVersion,
    ...(cacheVersion === undefined ? {} : { cacheVersion }),
  })
  return {
    stats,
    fetch: async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname
      if (request.method === "GET" && pathname === "/stats")
        return Response.json(stats)
      if (
        request.method !== "POST" ||
        !["/solve", "/solve-batch"].includes(pathname)
      ) {
        return Response.json(
          { ok: false, message: "Unknown local high-density endpoint" },
          { status: 404 },
        )
      }
      let solveRequest: LocalHighDensityRequest
      try {
        const body: unknown = await request.json()
        if (pathname === "/solve-batch") {
          const batch = parseLocalHighDensityRequest(
            body,
            options.autorouterVersion,
            true,
          )
          stats.batchRequests++
          const lines = batch.items.map((item) => {
            const key = getLocalHighDensityCacheKey({
              ...batch,
              input: item.input,
            })
            const cached = cache.get(key)
            if (cached === undefined) {
              stats.cacheMisses++
              return {
                requestId: item.requestId,
                ok: false,
                ...identity(batch.cacheVersion),
                code: "CACHE_MISS",
                message: "Exact local cache entry is absent",
              }
            }
            stats.cacheHits++
            return {
              requestId: item.requestId,
              ok: true,
              ...identity(batch.cacheVersion),
              source: "cache",
              ...cached,
            }
          })
          return new Response(
            lines.map((line) => JSON.stringify(line)).join("\n") +
              (lines.length ? "\n" : ""),
            {
              headers: { "content-type": "application/x-ndjson" },
            },
          )
        }
        solveRequest = parseLocalHighDensityRequest(
          body,
          options.autorouterVersion,
          false,
        )
      } catch (error) {
        return Response.json(
          {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 400 },
        )
      }
      const key = getLocalHighDensityCacheKey(solveRequest)
      stats.solveRequests++
      const cached = cache.get(key)
      if (cached !== undefined) {
        stats.cacheHits++
        return Response.json({
          ok: true,
          ...identity(solveRequest.cacheVersion),
          source: "cache",
          ...cached,
        })
      }
      try {
        let pending = inFlight.get(key)
        if (pending === undefined) {
          pending = (async (): Promise<LocalHighDensityObject> => {
            await previousSolve
            const start = performance.now()
            const helperResult = await options.solve(solveRequest.input)
            assertLocalHighDensityTerminalResult(
              helperResult,
              solveRequest.input,
            )
            const output = normalizeLocalHighDensityJson(
              helperResult,
            ) as LocalHighDensityObject
            stats.computeMs += performance.now() - start
            stats.jobsComputed++
            cache.set(key, output)
            return output
          })()
          previousSolve = pending.then((): void => {})
          void previousSolve.catch((): void => {})
          inFlight.set(key, pending)
        }
        const output = await pending
        return Response.json({
          ok: true,
          ...identity(solveRequest.cacheVersion),
          source: "solver",
          ...output,
        })
      } catch (error) {
        const fault = error instanceof Error ? error : new Error(String(error))
        options.onFault(fault)
        return Response.json(
          { ok: false, message: fault.message },
          { status: 500 },
        )
      } finally {
        inFlight.delete(key)
      }
    },
  }
}
