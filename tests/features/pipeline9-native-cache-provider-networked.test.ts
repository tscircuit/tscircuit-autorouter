import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { createNetworkedNode, solveNetworkedHighDensitySolver } from "../fixtures/pipeline9-networked-fixtures"

test("networked native null survives JSON and custom providers never enter service requests", async (): Promise<void> => {
  // Exercise the actual JSON/NDJSON client and production helper without a
  // socket listener; test environments may prohibit local listening sockets.
  const requests: Pipeline9NetworkedSolveBatchRequest[] = []
  const handleRequest = async (...[url, init]: Parameters<typeof fetch>): Promise<Response> => {
    if (String(url) !== "http://cache-policy.invalid/solve-batch") throw new Error(`Unexpected native cache test request ${String(url)}`)
    const body = JSON.parse(String(init?.body)) as Pipeline9NetworkedSolveBatchRequest
    requests.push(body)
    const lines = body.items.map((item) => JSON.stringify({ requestId: item.requestId, ok: true,
      autorouterVersion: AUTOROUTER_VERSION, cacheVersion: body.cacheVersion, source: "solver",
      ...solvePipeline9NetworkedHighDensityNode(item.input) }))
    return new Response(lines.join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } })
  }
  const transport = spyOn(globalThis, "fetch").mockImplementation(Object.assign(handleRequest, { preconnect: fetch.preconnect }))
  const globalCache = getGlobalInMemoryCache()
  const read = spyOn(globalCache, "getCachedSolutionSync")
  const write = spyOn(globalCache, "setCachedSolutionSync")
  const params = { nodePortPoints: [createNetworkedNode({ nodeId: "provider-networked", connectionName: "signal" })], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1, autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl: "http://cache-policy.invalid", hdCache2CacheVersion: "provider-policy", enableRegionalFallback: false }
  try {
    for (const cacheProvider of [null, undefined]) {
      globalCache.clearCache()
      read.mockClear()
      write.mockClear()
      const requestOffset = requests.length
      const outputs = []
      for (let repeat = 0; repeat < 2; repeat++) {
        const solver = new Pipeline9NetworkedHighDensitySolver({ ...params, cacheProvider })
        await solveNetworkedHighDensitySolver(solver)
        expect(solver.solved).toBe(true)
        expect(solver.stats.remoteSolverResults).toBe(1)
        outputs.push(solver.routes)
      }
      expect(outputs[0]).toEqual(outputs[1])
      for (const body of requests.slice(requestOffset)) {
        expect(body.cacheVersion).toBe("provider-policy")
        for (const item of body.items) expect(item.input.cacheProvider).toBe(cacheProvider)
      }
      const nativeReads = read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))
      const nativeWrites = write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))
      if (cacheProvider === null) {
        expect(nativeReads).toHaveLength(0)
        expect(nativeWrites).toHaveLength(0)
      } else {
        expect(nativeReads.length).toBeGreaterThan(0)
        expect(globalCache.cacheHitsByPrefix["intranode-solver"]).toBeGreaterThan(0)
      }
    }
    const sampleInput = requests[0]!.items[0]!.input
    expect(() => solvePipeline9NetworkedHighDensityNode({ ...sampleInput, cacheProvider: {} } as never)).toThrow("must be omitted or null")
    const requestCount = requests.length
    const custom = new InMemoryCache()
    read.mockClear()
    write.mockClear()
    for (let repeat = 0; repeat < 2; repeat++) {
      const solver = new Pipeline9NetworkedHighDensitySolver({ ...params, cacheProvider: custom })
      await solveNetworkedHighDensitySolver(solver)
      expect(solver.solved).toBe(true)
      expect(solver.stats.remoteRequestsStarted).toBe(0)
    }
    expect(requests).toHaveLength(requestCount)
    expect(custom.cacheHitsByPrefix["intranode-solver"]).toBeGreaterThan(0)
    expect(read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
    expect(write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))).toHaveLength(0)
  } finally {
    read.mockRestore()
    write.mockRestore()
    globalCache.clearCache()
    transport.mockRestore()
  }
})
