import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph";
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc";
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios";

test("Pipeline9 reroutes contiguous preloaded sections in corrected SRJ23 sample 4", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 4);
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  );

  solver.solve();

  expect(solver.solved).toBeTrue();
  expect(solver.failed).toBeFalse();
  expect(
    Number(solver.highDensityRouteSolver?.stats.fallbackNodeCount),
  ).toBeGreaterThan(0);
  expect(solver.getMutatedPreloadedTraces().length).toBeGreaterThan(0);
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  });
  expect(errors).toHaveLength(0);
});
