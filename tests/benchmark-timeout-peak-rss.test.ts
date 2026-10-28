import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBenchmarkTasks } from "../scripts/benchmark/index"
import { writeCpuBoundBenchmarkChild } from "./fixtures/writeCpuBoundBenchmarkChild"

test.skipIf(process.platform !== "linux")(
  "timeouts retain OS peak RSS when the child's progress timer is blocked",
  async (): Promise<void> => {
    const originalCwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), "benchmark-timeout-rss-"))
    try {
      await writeCpuBoundBenchmarkChild(directory)
      process.chdir(directory)
      const [result] = await runBenchmarkTasks(
        [
          {
            datasetName: "test",
            solverName: "test",
            scenarioName: "cpu-bound",
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
        1500,
      )
      expect(result.didTimeout).toBe(true)
      expect(result.didSolve).toBe(false)
      expect(result.peakRssBytes).toBeGreaterThan(192 * 1024 ** 2)
    } finally {
      process.chdir(originalCwd)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
