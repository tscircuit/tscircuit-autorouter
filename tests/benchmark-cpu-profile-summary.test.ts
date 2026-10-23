import { expect, test } from "bun:test"
import { profile, type SamplingProfile } from "bun:jsc"
import { summarizeBenchmarkCpuProfile } from "../scripts/benchmark/summarizeBenchmarkCpuProfile"

test("CPU research summary deduplicates recursive inclusive frames and supports async native profiling", async () => {
  const frame = { sourceID: 7, name: "search", location: "", line: 1, column: 1, category: "DFG", flags: 0 }
  const sampled: SamplingProfile = {
    functions: "self report",
    bytecodes: "tier report",
    stackTraces: {
      interval: 0.01,
      sources: [{ sourceID: 7, url: "search.ts" }],
      traces: [
        { timestamp: 1, frames: [frame, frame] },
        { timestamp: 2, frames: [{ ...frame, name: "cost" }, frame] },
      ],
    },
  }
  const summary = summarizeBenchmarkCpuProfile(sampled)
  expect(summary.sampleCount).toBe(2)
  expect(summary.inclusive[0]).toEqual({ source: "search.ts", name: "search", self: 1, inclusive: 2 })
  expect(summary.self.find(value => value.name === "cost")?.self).toBe(1)
  expect(sampled.stackTraces.traces[0]!.frames).toHaveLength(2)
  let callbackFinished = false
  const actual = await profile(async (): Promise<void> => {
    await Promise.resolve()
    callbackFinished = true
  }, 10_000)
  expect(callbackFinished).toBe(true)
  expect(typeof actual.functions).toBe("string")
  expect(typeof summarizeBenchmarkCpuProfile(actual).sampleCount).toBe("number")
})
