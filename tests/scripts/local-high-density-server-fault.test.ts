import { expect, test } from "bun:test"
import { createLocalHighDensityServer } from "../../scripts/benchmark/createLocalHighDensityServer"
import type { LocalHighDensityObject } from "../../scripts/benchmark/localHighDensityProtocol"

test("local server reports helper faults without caching or substituting a solved result", async () => {
  const faults: Error[] = []
  const failure = new Error("unexpected helper invariant")
  const handler = createLocalHighDensityServer({
    autorouterVersion: "0.0.968",
    solve: (_input: LocalHighDensityObject): LocalHighDensityObject => { throw failure },
    onFault: (error: Error): void => { faults.push(error) },
  })
  const envelope = { autorouterVersion: "0.0.968", cacheVersion: "sample-1", input: { solvePolicy: "test_v1" } }
  const response = await handler.fetch(new Request("http://127.0.0.1/solve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope),
  }))
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ ok: false, message: failure.message })
  expect(faults).toEqual([failure])
  expect(handler.stats.jobsComputed).toBe(0)
  const lookup = await handler.fetch(new Request("http://127.0.0.1/solve-batch", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ autorouterVersion: envelope.autorouterVersion, cacheVersion: envelope.cacheVersion, items: [{ requestId: "failed-job", input: envelope.input }] }),
  }))
  expect(JSON.parse((await lookup.text()).trim())).toMatchObject({ requestId: "failed-job", ok: false, code: "CACHE_MISS" })
})
