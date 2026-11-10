import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("completed mesh stages release search indexes while keeping their routing output", (): void => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario) as SimpleRouteJson,
    { cacheProvider: null },
  )
  pipeline.solveUntilPhase("portPointPathingSolver")
  const edgeSolver =
    pipeline.edgeSolver as CapacityMeshEdgeSolver2_NodeTreeOptimization
  const crampedSolver = pipeline.necessaryCrampedPortPointSolver!
  expect(edgeSolver.solved).toBe(true)
  expect(edgeSolver.edges.length).toBeGreaterThan(0)
  expect(edgeSolver["nodeTree"].buckets.size).toBe(0)
  expect(edgeSolver["edgeSet"].size).toBe(0)
  expect(edgeSolver.visualize().lines?.length).toBeGreaterThan(0)
  expect(crampedSolver.solved).toBe(true)
  expect(crampedSolver["escapeIndex"]).toBeUndefined()
  expect(crampedSolver["mapOfCapacityMeshNodeIdToSegmentPortPoints"].size).toBe(
    0,
  )
  const segments = crampedSolver.getOutput()
  expect(segments.length).toBeGreaterThan(0)
  expect(crampedSolver.getOutput()).toBe(segments)
})
