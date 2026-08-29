import { expect, test } from "bun:test"
import type { WorkerResult } from "../scripts/benchmark/benchmark-types"
import {
  DEFAULT_NETWORKED_CACHE_PROPAGATION_DELAY_MS,
  parseNetworkedCachePropagationDelayMs,
  validateNetworkedColdHotResults,
  validateNetworkedColdPassReadyForHot,
} from "../scripts/benchmark/index"

test("networked cold-hot validation requires a fresh cold solve and complete hot hits", () => {
  const createResult = (
    solverName: string,
    cacheHits: number,
    solverResults: number,
  ): WorkerResult => ({
    solverName,
    scenarioName: "sample001",
    sampleNumber: 1,
    elapsedTimeMs: 100,
    didSolve: true,
    didTimeout: false,
    relaxedDrcPassed: true,
    routingMetrics: {
      networkedHighDensity: {
        remoteRequestsStarted: 3,
        remoteRequestsCompleted: 3,
        remoteBatchCacheMisses: solverResults,
        remoteSingleRequestsStarted: solverResults,
        remoteCacheHits: cacheHits,
        remoteSolverResults: solverResults,
        remoteTransportFallbacks: 0,
      },
    },
  })
  const cold = createResult("Pipeline9_Networked Cold", 0, 3)
  const hot = createResult("Pipeline9_Networked Hot", 3, 0)

  expect(() => validateNetworkedColdHotResults([cold, hot])).not.toThrow()
  expect(() =>
    validateNetworkedColdHotResults([
      cold,
      createResult("Pipeline9_Networked Hot", 2, 1),
    ]),
  ).toThrow("hot pass returned 2/3 remote cache hits")
  expect(() =>
    validateNetworkedColdPassReadyForHot([
      {
        ...cold,
        didTimeout: true,
        routingMetrics: undefined,
      },
    ]),
  ).toThrow("cannot start hot pass")
  expect(() =>
    validateNetworkedColdHotResults([
      cold,
      { ...hot, didTimeout: true, routingMetrics: undefined },
    ]),
  ).toThrow("hot pass completed 0/1 drained task(s)")
  expect(parseNetworkedCachePropagationDelayMs(undefined)).toBe(
    DEFAULT_NETWORKED_CACHE_PROPAGATION_DELAY_MS,
  )
  expect(parseNetworkedCachePropagationDelayMs("0")).toBe(0)
  expect(() => parseNetworkedCachePropagationDelayMs("1.5")).toThrow(
    "must be a non-negative integer",
  )
})
