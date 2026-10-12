import { expect, test } from "bun:test"
import { createSolverForTask } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("networked task solver receives its lane endpoint and namespace without using remote environment", (): void => {
  const originalUrl = process.env.HD_CACHE2_SERVER_URL
  const originalVersion = process.env.HD_CACHE2_CACHE_VERSION
  process.env.HD_CACHE2_SERVER_URL = "http://remote-must-not-be-used.invalid"
  process.env.HD_CACHE2_CACHE_VERSION = "remote-namespace"
  const task: BenchmarkTask = {
    datasetName: "srj18",
    solverName: "Pipeline9_Networked Cold",
    solverConstructorName: "AutoroutingPipelineSolver9_Networked",
    networkedCachePass: "cold",
    scenarioName: "fixture",
    sampleNumber: 1,
    scenario: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [],
      connections: [],
    },
    networkedServer: {
      url: "http://127.0.0.1:43210",
      cacheVersion: "run-sample-1",
    },
  }
  try {
    const solver = createSolverForTask(task) as unknown as {
      hdCache2ServerUrl: string
      hdCache2CacheVersion: string
    }
    expect(solver.hdCache2ServerUrl).toBe(task.networkedServer!.url)
    expect(solver.hdCache2CacheVersion).toBe(task.networkedServer!.cacheVersion)
    expect(() =>
      createSolverForTask({ ...task, networkedServer: undefined }),
    ).toThrow("requires a configured local cluster")
  } finally {
    if (originalUrl === undefined) delete process.env.HD_CACHE2_SERVER_URL
    else process.env.HD_CACHE2_SERVER_URL = originalUrl
    if (originalVersion === undefined)
      delete process.env.HD_CACHE2_CACHE_VERSION
    else process.env.HD_CACHE2_CACHE_VERSION = originalVersion
  }
})
