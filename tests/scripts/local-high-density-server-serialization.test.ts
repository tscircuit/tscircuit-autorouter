import { expect, test } from "bun:test"
import { createLocalHighDensityServer } from "../../scripts/benchmark/createLocalHighDensityServer"
import type { LocalHighDensityObject } from "../../scripts/benchmark/localHighDensityProtocol"

test("one local server serializes distinct jobs and deduplicates in-flight exact inputs", async () => {
  let releaseFirst!: () => void
  let startedFirst!: () => void
  const firstStarted = new Promise<void>((resolve): void => { startedFirst = resolve })
  const firstGate = new Promise<void>((resolve): void => { releaseFirst = resolve })
  const order: string[] = []
  const handler = createLocalHighDensityServer({
    autorouterVersion: "0.0.968",
    solve: async (input: LocalHighDensityObject): Promise<LocalHighDensityObject> => {
      order.push(`start-${input.id}`)
      if (input.id === "first") { startedFirst(); await firstGate }
      order.push(`end-${input.id}`)
      return { status: "failed", solutionStage: "ordinary", error: "deterministic solve failure" }
    },
    onFault: (error: Error): void => { throw error },
  })
  const send = async (id: string): Promise<Response> => {
    return await handler.fetch(new Request("http://127.0.0.1/solve", {
      method: "POST", body: JSON.stringify({ autorouterVersion: "0.0.968", input: { solvePolicy: "test_v1", id } }),
      headers: { "content-type": "application/json" },
    }))
  }
  const first = send("first")
  await firstStarted
  const duplicate = send("first")
  const second = send("second")
  await Promise.resolve()
  expect(order).toEqual(["start-first"])
  releaseFirst()
  await Promise.all([first, duplicate, second])
  expect(order).toEqual(["start-first", "end-first", "start-second", "end-second"])
  expect(handler.stats.jobsComputed).toBe(2)
  const cachedFailure = await (await send("first")).json() as Record<string, unknown>
  expect(cachedFailure).toMatchObject({ ok: true, source: "cache", status: "failed", error: "deterministic solve failure" })
})
