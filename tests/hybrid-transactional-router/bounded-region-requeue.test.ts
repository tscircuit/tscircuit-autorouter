import { expect, test } from "bun:test"
import {
  createExpandedRegionRequeue,
  isEnvelopeRecoveryEligible,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/bounded-region-recovery"
import type { DynamicRoutingRegion } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/planning-types"

test("requeues no-path regions through bounded board-clamped envelopes", () => {
  const region: DynamicRoutingRegion = {
    regionId: "region:bounded-requeue",
    routeObjectIds: ["route:signal"],
    connectionNames: ["signal"],
    ownedPreloadedCopperIds: [],
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    maximumEnvelope: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
    overlapReserveMm: 1,
    neighboringRegionIds: [],
    dependencyRegionIds: [],
    conflictRegionIds: [],
    criticality: 1,
    congestionPressure: 1,
    estimatedSolverWork: 1,
    estimatedMemoryBytes: 1,
    mutationGeneration: 0,
  }
  const boardBounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 }
  const first = createExpandedRegionRequeue({
    region,
    boardBounds,
    requeueIndex: 1,
  })

  expect(first?.maximumEnvelope).toEqual({
    minX: -4,
    maxX: 5,
    minY: -4,
    maxY: 5,
  })
  expect(first?.mutationGeneration).toBe(1)
  expect(
    isEnvelopeRecoveryEligible({
      failureCode: "core_search_failed",
      coreFailureCode: "no_legal_path",
    }),
  ).toBe(true)
  expect(
    isEnvelopeRecoveryEligible({
      failureCode: "core_search_failed",
      coreFailureCode: "search_budget_exhausted",
    }),
  ).toBe(false)
  if (!first) return
  const second = createExpandedRegionRequeue({
    region: first,
    boardBounds,
    requeueIndex: 2,
  })

  expect(second?.maximumEnvelope).toEqual(boardBounds)
  expect(second?.mutationGeneration).toBe(2)
  if (!second) return
  expect(
    createExpandedRegionRequeue({
      region: second,
      boardBounds,
      requeueIndex: 3,
    }),
  ).toBeUndefined()
})
