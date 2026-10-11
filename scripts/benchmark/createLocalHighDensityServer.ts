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
            const output = normalizeLocalHighDensityJson(
              await options.solve(solveRequest.input),
            )
            if (
              output === null ||
              typeof output !== "object" ||
              Array.isArray(output) ||
              !["solved", "failed"].includes(String(output.status)) ||
              typeof output.solutionStage !== "string"
            ) {
              throw new TypeError(
                "Local high-density helper returned an invalid terminal result",
              )
            }
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
