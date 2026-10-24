import { expect, test } from "bun:test"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import { NegotiateTraceClearanceSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/NegotiateTraceClearanceSolver"
import { Pipeline9BoundedRegionalRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

test("mesh diagnostics retain partial setup, interrupted children and completed work without changing native stats", () => {
  const negotiation = new NegotiateTraceClearanceSolver({
    routes: [], srj: { layerCount: 2, obstacles: [] }, maxPathSearchNodes: 100, maxPathSearchCalls: 2,
  } as never)
  const internals = negotiation as unknown as {
    pathSolver?: FindClearancePathSolver
    accountMeshPath(): void
  }
  const bounded = new Pipeline9BoundedRegionalRepairSolver({ routes: [] } as never)
  const state = bounded as unknown as { state: unknown; completedMeshDiagnostics: Record<string, number> }
  state.state = { phase: "negotiate", solver: negotiation }
  const joint = Object.create(Pipeline9JointDrcRepairSolver.prototype) as Pipeline9JointDrcRepairSolver
  joint.initialBoundedRegionalRepairSolver = bounded
  joint.boundedRegionalRepairSolver = bounded // Aliased wrapper must not double count.
  const stable = { ...negotiation.stats }
  const first = new FindClearancePathSolver(createMeshInput())
  internals.pathSolver = first
  Object.assign(first.stats, { meshConstructionWork: 17, meshUnionCalls: 3 })
  expect(joint.benchmarkDiagnosticCounters).toMatchObject({
    meshConstructionWork: 17, meshUnionCalls: 3, meshSearchesStarted: 1, meshPathChildrenPending: 1,
  })
  // A construction error can interrupt the outer solver before apply-path.
  first.failed = true
  expect(joint.benchmarkDiagnosticCounters).toMatchObject({ meshPathChildrenFailed: 1, meshPathChildrenPending: 0 })
  first.failed = false
  first.solved = true
  first.stats.completionReason = "geometry-limit"
  internals.accountMeshPath()
  internals.accountMeshPath()
  expect(joint.benchmarkDiagnosticCounters).toMatchObject({ meshConstructionWork: 17, meshGeometryLimitSearches: 1 })
  const second = new FindClearancePathSolver(createMeshInput())
  internals.pathSolver = second
  Object.assign(second.stats, { meshConstructionWork: 11, meshQueuePushes: 9, nodesPopped: 4 })
  expect(joint.benchmarkDiagnosticCounters).toMatchObject({
    meshConstructionWork: 28, meshQueuePushes: 9, meshSearchNodesPopped: 4,
    meshPathChildren: 2, meshPathChildrenPending: 1, meshPathChildrenFinished: 1,
  })
  second.solved = true
  second.stats.completionReason = "node-limit"
  internals.accountMeshPath()
  internals.pathSolver = undefined
  // Completion transfers the snapshot before the regional state drops its child.
  Object.assign(state.completedMeshDiagnostics, negotiation.benchmarkDiagnosticCounters)
  state.state = { phase: "splice-region" }
  expect(joint.benchmarkDiagnosticCounters).toMatchObject({
    meshConstructionWork: 28, meshSearchNodesPopped: 4, meshNodeLimitSearches: 1,
    meshGeometryLimitSearches: 1, meshPathChildrenPending: 0, meshPathChildrenFinished: 2,
  })
  expect(negotiation.stats).toEqual(stable)
})
