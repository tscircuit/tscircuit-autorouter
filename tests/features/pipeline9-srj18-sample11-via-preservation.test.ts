import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves SRJ18 sample 11 vias through DRC repair", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 11)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const forceImproveInput =
    solver.globalDrcForceImproveSolver!.inputHdRoutes.find(
      (route) => route.connectionName === "source_trace_54__source_net_54_mst0",
    )!
  const forceImproveGuardedInput =
    solver.globalDrcForceImproveSolver!.guardedInputHdRoutes.find(
      (route) => route.connectionName === "source_trace_54__source_net_54_mst0",
    )!
  const layerTransition = forceImproveInput.route.find(
    (point, index, route) => index > 0 && route[index - 1]!.z !== point.z,
  )!
  const transitionStart =
    forceImproveInput.route[
      forceImproveInput.route.indexOf(layerTransition) - 1
    ]!

  expect(transitionStart.x).toBe(layerTransition.x)
  expect(transitionStart.y).toBe(layerTransition.y)
  expect(forceImproveInput.vias).toContainEqual({
    x: layerTransition.x,
    y: layerTransition.y,
  })
  expect(forceImproveGuardedInput.vias).toContainEqual({
    x: layerTransition.x,
    y: layerTransition.y,
  })
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toHaveLength(0)
}, 120_000)
