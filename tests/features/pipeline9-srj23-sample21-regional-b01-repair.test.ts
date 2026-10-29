import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"

test("Pipeline9 finishes SRJ23 peer repair without increasing final DRC residue", async (): Promise<void> => {
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
  expect(errors).toHaveLength(2)
  expect(errors.map((error) => error.type).sort()).toEqual([
    "pcb_pad_pad_clearance_error",
    "pcb_pad_pad_clearance_error",
  ])
  const jointRepair = solver.pipeline9JointDrcRepairSolver!
  const signal = solver._getOutputHdRoutes().find(
    (route) => route.connectionName === "source_net_6_mst0",
  )!
  const section = jointRepair.movablePreloadedSections.find(
    (section) => section.syntheticConnectionName === "pipeline9_preloaded_drc_2",
  )!
  const preloadedTrace = jointRepair.getUpdatedPreloadedTraces().find(
    (trace) => trace.pcb_trace_id === section.originalTrace.pcb_trace_id,
  )!
  const preloadedRoutes = convertPreloadedTraceToHdRoutes(
    preloadedTrace, 0, scenario.layerCount, 0.3, jointRepair.params.connMap,
  )
  expect(signal).toBeDefined()
  expect(preloadedRoutes.length).toBeGreaterThan(0)
  let minimumCopperGap = Infinity
  for (let i = 1; i < signal.route.length; i++) {
    const a = signal.route[i - 1]!
    const b = signal.route[i]!
    for (const preloaded of preloadedRoutes) for (let j = 1; j < preloaded.route.length; j++) {
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
})
