import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph";
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc";
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios";

test("Pipeline9 bounds preliminary joint DRC work for SRJ23 sample 52", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 52);
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  );

  solver.solve();

  expect(solver.solved).toBeTrue();
  expect(solver.failed).toBeFalse();
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .globalDrcForceImproveMaxIterations,
    ),
  ).toBeLessThanOrEqual(8);
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  });
  expect(errors).toHaveLength(0);
});
