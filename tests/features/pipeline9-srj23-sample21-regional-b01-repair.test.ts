import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves SRJ23 peer isolation while reporting repair residue", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 21)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .regionalB01RepairPreloadEligibleDrcIssueCount,
  ).toBeLessThanOrEqual(1)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // The former two-error result moved net 6 onto the top layer through a
  // preloaded net 3 trace. The reference evaluator did not report that short.
  // Keep the safe route and its visible pad/via residue instead.
  expect(errors).toHaveLength(7)
  expect(errors.map((error) => error.type).sort()).toEqual([
    "pcb_pad_pad_clearance_error",
    "pcb_pad_pad_clearance_error",
    "pcb_pad_pad_clearance_error",
    "pcb_pad_pad_clearance_error",
    "pcb_pad_pad_clearance_error",
    "pcb_pad_trace_clearance_error",
    "pcb_trace_error",
  ])
  const exactRepair = solver.pipeline9JointDrcRepairSolver!.exactRepairSolver!
  const routes = exactRepair.getOutput()
  const signal = routes.find(
    (route) => route.connectionName === "source_net_6_mst0",
  )!
  const preloaded = routes.find(
    (route) => route.connectionName === "pipeline9_preloaded_drc_2",
  )!
  expect(signal).toBeDefined()
  expect(preloaded).toBeDefined()
  expect(signal.rootConnectionName).not.toBe(preloaded.rootConnectionName)
  let minimumCopperGap = Infinity
  for (let i = 1; i < signal.route.length; i++) {
    const a = signal.route[i - 1]!
    const b = signal.route[i]!
    for (let j = 1; j < preloaded.route.length; j++) {
      const c = preloaded.route[j - 1]!
      const d = preloaded.route[j]!
      if (a.z !== b.z || c.z !== d.z || a.z !== c.z) continue
      minimumCopperGap = Math.min(
        minimumCopperGap,
        segmentToSegmentMinDistance(a, b, c, d) -
          (signal.traceThickness + preloaded.traceThickness) / 2,
      )
    }
  }
  expect(Number.isFinite(minimumCopperGap)).toBeTrue()
  expect(minimumCopperGap).toBeGreaterThanOrEqual(0)
  expect(
    exactRepair.stats.drcBranchPortfolioPeerTraceRepairRolledBack,
  ).toBeTrue()
})
