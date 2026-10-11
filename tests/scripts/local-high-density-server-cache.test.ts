import { expect, test } from "bun:test"
import { createLocalHighDensityServer } from "../../scripts/benchmark/createLocalHighDensityServer"
import type { LocalHighDensityObject } from "../../scripts/benchmark/localHighDensityProtocol"

test("local server batch lookup never computes and preserves cached complete results in request order", async () => {
  const faults: Error[] = []
  const jobs: string[] = []
  const handler = createLocalHighDensityServer({
    autorouterVersion: "0.0.968",
    solve: (input: LocalHighDensityObject): LocalHighDensityObject => {
      jobs.push(String(input.id))
      return input.id === "repair" ? {
        status: "solved", solutionStage: "repair", repairedRoutes: [{ capacityMeshNodeId: "node", route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }],
        clearanceStats: { nodeClearanceInitialConflictCount: 1, nodeClearanceFinalConflictCount: 0, nodeClearanceCandidateCount: 2 },
      } : { status: "solved", solutionStage: "ordinary", routes: [], forceImproved: true }
    },
    onFault: (error: Error): void => { faults.push(error) },
  })
  const send = async (path: string, body: object): Promise<Response> => {
    const request = new Request(`http://127.0.0.1${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    return await handler.fetch(request)
  }
  const identity = { autorouterVersion: "0.0.968", cacheVersion: "sample-1" }
  const repair = { solvePolicy: "repair_v1", id: "repair" }
  const hdr = { solvePolicy: "ordinary_v1", id: "hdr" }
  const batch = { ...identity, items: [{ requestId: "later", input: repair }, { requestId: "earlier", input: hdr }] }
  const cold = await send("/solve-batch", batch)
  expect(cold.headers.get("content-type")).toBe("application/x-ndjson")
  expect((await cold.text()).trim().split("\n").map((line) => JSON.parse(line))).toEqual(batch.items.map((item) => ({ requestId: item.requestId, ok: false, ...identity, code: "CACHE_MISS", message: "Exact local cache entry is absent" })))
  expect(jobs).toEqual([])
  const repairResponse = await (await send("/solve", { ...identity, input: repair })).json() as Record<string, unknown>
  const hdrResponse = await (await send("/solve", { ...identity, input: hdr })).json() as Record<string, unknown>
  expect(repairResponse.source).toBe("solver")
  expect(hdrResponse.forceImproved).toBe(true)
  const warm = (await (await send("/solve-batch", batch)).text()).trim().split("\n").map((line) => JSON.parse(line))
  expect(warm).toEqual([{ ...repairResponse, requestId: "later", source: "cache" }, { ...hdrResponse, requestId: "earlier", source: "cache" }])
  const namespaceMiss = await send("/solve-batch", { ...batch, cacheVersion: "sample-2" })
  expect((await namespaceMiss.text()).trim().split("\n").every((line) => JSON.parse(line).code === "CACHE_MISS")).toBe(true)
  expect((await send("/solve", { ...identity, autorouterVersion: "wrong", input: hdr })).status).toBe(400)
  expect(jobs).toEqual(["repair", "hdr"])
  expect(handler.stats.jobsComputed).toBe(2)
  expect(faults).toEqual([])
})
