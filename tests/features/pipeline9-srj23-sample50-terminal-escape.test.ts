import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph";
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc";
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios";

test("Pipeline9 relocates an SRJ23 terminal escape within its own pad", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 50);
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  );

  solver.solve();

  expect(solver.solved).toBeTrue();
  expect(solver.failed).toBeFalse();
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.terminalEscapeAcceptedCount,
  ).toBeGreaterThan(0);
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  });
  expect(errors).toHaveLength(0);
});
