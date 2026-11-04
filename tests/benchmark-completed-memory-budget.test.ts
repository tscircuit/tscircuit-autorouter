import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBenchmarkTasks } from "../scripts/benchmark/index"

test.skipIf(process.platform !== "linux")(
  "a reported final peak over the RSS budget cannot count as a successful sample",
  async (): Promise<void> => {
    const originalCwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), "benchmark-completed-rss-"))
    try {
      await mkdir(join(directory, "scripts/benchmark"), { recursive: true })
      await writeFile(
        join(directory, "scripts/benchmark/benchmark.child.ts"),
        `console.log(JSON.stringify({ taskId: 1, result: {
  solverName: "test", scenarioName: "finished", sampleNumber: 1,
  elapsedTimeMs: 1, didSolve: true, didTimeout: false, relaxedDrcPassed: true,
  peakRssBytes: 192 * 1024 * 1024,
} }))
`,
      )
      process.chdir(directory)
      const [result] = await runBenchmarkTasks(
        [
          {
            datasetName: "test",
            solverName: "test",
            scenarioName: "finished",
            sampleNumber: 1,
            scenario: {
              layerCount: 2,
              minTraceWidth: 0.1,
              obstacles: [],
              connections: [],
              bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
            },
          },
        ],
        1,
        10_000,
        { sampleMaxRssBytes: 96 * 1024 ** 2 },
      )
      expect(result.didSolve).toBe(false)
      expect(result.relaxedDrcPassed).toBe(false)
      expect(result.error).toContain("Exceeded RSS limit of 96.0 MiB")
      expect(result.sampleMaxRssBytes).toBe(96 * 1024 ** 2)
    } finally {
      process.chdir(originalCwd)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
