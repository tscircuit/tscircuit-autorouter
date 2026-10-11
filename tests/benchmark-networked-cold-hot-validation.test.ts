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
  const incomplete = createResult("Pipeline9_Networked Cold", 0, 3)
  incomplete.routingMetrics!.networkedHighDensity!.remoteRequestsCompleted = 2
  expect(() => validateNetworkedColdPassReadyForHot([incomplete])).toThrow(
    "cannot start hot pass",
  )
  expect(() =>
    validateNetworkedColdHotResults([
      cold,
      { ...incomplete, solverName: "Pipeline9_Networked Hot" },
    ]),
  ).toThrow("hot pass completed 0/1 drained task(s)")
  const unexpectedCompute = createResult("Pipeline9_Networked Hot", 3, 1)
  expect(() =>
    validateNetworkedColdHotResults([cold, unexpectedCompute]),
  ).toThrow("computed work")
  const localOptions = { allowValidationRejections: true }
  const localCold = structuredClone(cold)
  const localColdMetrics = localCold.routingMetrics!.networkedHighDensity!
  localColdMetrics.remoteSolverResults = 2
  localColdMetrics.remoteTransportFallbacks = 1
  localColdMetrics.remoteFallbackReasonCounts = { invalid_response: 1 }
  const localHot = structuredClone(hot)
  const localHotMetrics = localHot.routingMetrics!.networkedHighDensity!
  localHotMetrics.remoteCacheHits = 2
  localHotMetrics.remoteTransportFallbacks = 1
  localHotMetrics.remoteFallbackReasonCounts = { invalid_response: 1 }
  expect(() =>
    validateNetworkedColdHotResults([localCold, localHot], localOptions),
  ).not.toThrow()
  expect(() => validateNetworkedColdHotResults([localCold, localHot])).toThrow(
    "cold pass used 1 local transport fallback",
  )
  const invalidReasonCounts: Array<Record<string, number> | undefined> = [
    undefined,
    { logical_timeout: 1 },
    { unexpected_new_reason: 1 },
    { invalid_response: 1, transport_timeout: 1 },
    { invalid_response: 0.5 },
    { invalid_response: -1 },
    { invalid_response: Number.NaN },
    { invalid_response: Number.POSITIVE_INFINITY },
  ]
  for (const reasons of invalidReasonCounts) {
    const invalidCold = structuredClone(localCold)
    invalidCold.routingMetrics!
      .networkedHighDensity!.remoteFallbackReasonCounts = reasons
    expect(() =>
      validateNetworkedColdPassReadyForHot([invalidCold], localOptions),
    ).toThrow()
  }
  const mixedFailure = structuredClone(localCold)
  mixedFailure.routingMetrics!.networkedHighDensity!.remoteTransportFallbacks =
    2
  mixedFailure.routingMetrics!
    .networkedHighDensity!.remoteFallbackReasonCounts = {
    invalid_response: 1,
    network_error: 1,
  }
  expect(() =>
    validateNetworkedColdPassReadyForHot([mixedFailure], localOptions),
  ).toThrow("cold pass used 2 local transport fallback")
  const invalidHot = structuredClone(localHot)
  invalidHot.routingMetrics!.networkedHighDensity!.remoteFallbackReasonCounts =
    {
      logical_timeout: 1,
    }
  expect(() =>
    validateNetworkedColdHotResults([localCold, invalidHot], localOptions),
  ).toThrow("hot pass used 1 local transport fallback")
  const changedRequests = structuredClone(localHot)
  const changedRequestMetrics =
    changedRequests.routingMetrics!.networkedHighDensity!
  changedRequestMetrics.remoteRequestsStarted = 4
  changedRequestMetrics.remoteRequestsCompleted = 4
  changedRequestMetrics.remoteCacheHits = 3
  expect(() =>
    validateNetworkedColdHotResults([localCold, changedRequests], localOptions),
  ).toThrow("changed request or validation rejection counts")
  const changedRejections = structuredClone(localHot)
  const changedRejectionMetrics =
    changedRejections.routingMetrics!.networkedHighDensity!
  changedRejectionMetrics.remoteCacheHits = 1
  changedRejectionMetrics.remoteTransportFallbacks = 2
  changedRejectionMetrics.remoteFallbackReasonCounts = { invalid_response: 2 }
  expect(() =>
    validateNetworkedColdHotResults(
      [localCold, changedRejections],
      localOptions,
    ),
  ).toThrow("changed request or validation rejection counts")
  const otherCold = {
    ...cold,
    scenarioName: "sample002",
    sampleNumber: 2,
  }
  const otherHot = {
    ...localHot,
    scenarioName: "sample002",
    sampleNumber: 2,
  }
  expect(() =>
    validateNetworkedColdHotResults(
      [localCold, otherCold, hot, otherHot],
      localOptions,
    ),
  ).toThrow("changed request or validation rejection counts")
  expect(() =>
    validateNetworkedColdHotResults(
      [localCold, localCold, localHot, otherHot],
      localOptions,
    ),
  ).toThrow("cold pass repeated a sample")
  expect(() =>
    validateNetworkedColdHotResults(
      [localCold, otherCold, localHot, localHot],
      localOptions,
    ),
  ).toThrow("did not match a unique cold sample")
  const incompleteColdAccounting = structuredClone(localCold)
  incompleteColdAccounting.routingMetrics!
    .networkedHighDensity!.remoteSolverResults = 1
  expect(() =>
    validateNetworkedColdPassReadyForHot(
      [incompleteColdAccounting],
      localOptions,
    ),
  ).toThrow(
    "1 accepted solver result(s) and 1 validation rejection(s) for 3 request(s)",
  )
  const repeatedColdInput = structuredClone(localCold)
  repeatedColdInput.routingMetrics!.networkedHighDensity!.remoteSolverResults =
    1
  repeatedColdInput.routingMetrics!.networkedHighDensity!.remoteCacheHits = 1
  expect(() =>
    validateNetworkedColdHotResults(
      [repeatedColdInput, localHot],
      localOptions,
    ),
  ).not.toThrow()
  const overcountedCold = structuredClone(otherCold)
  overcountedCold.routingMetrics!.networkedHighDensity!.remoteSolverResults = 4
  expect(() =>
    validateNetworkedColdPassReadyForHot(
      [incompleteColdAccounting, overcountedCold],
      localOptions,
    ),
  ).toThrow("sample001 returned")
  const localUnexpectedCompute = structuredClone(localHot)
  localUnexpectedCompute.routingMetrics!
    .networkedHighDensity!.remoteSolverResults = 1
  expect(() =>
    validateNetworkedColdHotResults(
      [localCold, localUnexpectedCompute],
      localOptions,
    ),
  ).toThrow("computed work")
  for (const changedResult of [
    { ...localHot, didSolve: false },
    { ...localHot, relaxedDrcPassed: false },
    { ...localHot, viaCount: 2 },
    { ...localHot, drcErrorCount: 1 },
  ]) {
    expect(() =>
      validateNetworkedColdHotResults([localCold, changedResult], localOptions),
    ).toThrow("changed routing result")
  }
  const equalRecordedCold = { ...localCold, viaCount: 2, drcErrorCount: 0 }
  const equalRecordedHot = { ...localHot, viaCount: 2, drcErrorCount: 0 }
  expect(() =>
    validateNetworkedColdHotResults(
      [equalRecordedCold, equalRecordedHot],
      localOptions,
    ),
  ).not.toThrow()
  expect(parseNetworkedCachePropagationDelayMs(undefined)).toBe(
    DEFAULT_NETWORKED_CACHE_PROPAGATION_DELAY_MS,
  )
  expect(parseNetworkedCachePropagationDelayMs("0")).toBe(0)
  expect(() => parseNetworkedCachePropagationDelayMs("1.5")).toThrow(
    "must be a non-negative integer",
  )
})
