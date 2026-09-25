import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 2 within its regional work budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 2)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  const pathedConnections = new Set(
    solver
      .portPointPathingSolver!.getOutput()
      .nodesWithPortPoints.flatMap((node) =>
        (node.portPointsInPairs ?? []).map(([start]) => start.connectionName),
      ),
  )
  expect(pathedConnections).toEqual(
    new Set(
      solver.srjWithPointPairs!.connections.map(
        (connection) => connection.name,
      ),
    ),
  )
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
  const stats = solver.pipeline9JointDrcRepairSolver!.stats
  const maxRegions = Number(stats.boundedRegionalRepairConfiguredMaxRegions)
  const maxCandidates = Number(
    stats.boundedRegionalRepairConfiguredMaxCandidateAttempts,
  )
  const maxNodes = Number(
    stats.boundedRegionalRepairConfiguredMaxPathSearchNodes,
  )
  // The complete MST enters the existing congested-board policy. Enforce
  // its selected work limits and the unchanged absolute policy ceilings.
  expect(maxRegions).toBeLessThanOrEqual(8)
  expect(maxCandidates).toBeLessThanOrEqual(2_048)
  expect(maxNodes).toBeLessThanOrEqual(10_000_000)
  expect(
    Number(stats.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(maxRegions)
  expect(
    Number(stats.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(maxCandidates)
  expect(
    Number(stats.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(maxNodes)
})
