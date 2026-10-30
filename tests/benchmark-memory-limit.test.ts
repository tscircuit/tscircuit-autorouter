import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBenchmarkTasks } from "../scripts/benchmark/index"
import { writeCpuBoundBenchmarkChild } from "./fixtures/writeCpuBoundBenchmarkChild"

test.skipIf(process.platform !== "linux")(
  "an externally measured RSS limit fails a CPU-bound sample before its timeout",
  async (): Promise<void> => {
    const originalCwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), "benchmark-memory-limit-"))
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
        10_000,
        { sampleMaxRssBytes: 96 * 1024 ** 2 },
      )
      expect(result.didSolve).toBe(false)
      expect(result.didTimeout).toBe(false)
      expect(result.error).toContain("Exceeded RSS limit of 96.0 MiB")
      expect(result.peakRssBytes).toBeGreaterThan(96 * 1024 ** 2)
      expect(result.elapsedTimeMs).toBeLessThan(10_000)
    } finally {
      process.chdir(originalCwd)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
