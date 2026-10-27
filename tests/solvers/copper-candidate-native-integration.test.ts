import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("native alternatives activate simultaneous copper selection and retain the original physical guards", () => detailedPriority(() => {
  const params = priorityParams()
  const native = new PriorityDagIntraNodeSolver(params)
  const candidate = new PriorityDagIntraNodeSolver({ ...params, copperCandidateSearch: true })
  native.solve()
  candidate.solve()
  expect(native.solved).toBe(true)
  expect(native.priorityDiagnostics.copperCandidateInstances).toBeUndefined()
  expect(candidate.solved).toBe(true)
  expect(candidate.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(candidate.iterations).toBeLessThanOrEqual(candidate.MAX_ITERATIONS)
  expect(candidate.priorityDiagnostics.copperCandidateRoutesArchived).toBeGreaterThan(3)
  expect(candidate.priorityDiagnostics.copperCandidateConflictsLearned).toBeGreaterThan(0)
  expect(candidate.priorityDiagnostics.copperCandidateConflictFactHits).toBeGreaterThan(0)
  expect(candidate.priorityDiagnostics.copperCandidateAssignmentsPublished).toBe(1)
  expect(candidate.priorityDiagnostics.priorityWorkUnits).toBe(candidate.iterations)
  expect(candidate.priorityDiagnostics.priorityCandidateSearchDispatches).toBeGreaterThan(0)
  expect(candidate.priorityDiagnostics.priorityCandidateOraclePriceCopies).toBeGreaterThan(0)
  expect(candidate.priorityDiagnostics.priorityCandidateConflictLookups).toBeGreaterThan(0)
  for (let left = 0; left < candidate.solvedRoutes.length; left++) {
    for (let right = left + 1; right < candidate.solvedRoutes.length; right++) {
      expect(doPipeline9RoutesHaveCopperConflict({
        left: candidate.solvedRoutes[left],
        right: candidate.solvedRoutes[right],
        clearance: params.obstacleMargin!,
        layerCount: 2,
      })).toBe(false)
    }
  }
}))
