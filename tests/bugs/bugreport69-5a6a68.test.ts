import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";
import phaseInputs from "../../fixtures/bug-reports/bugreport69-5a6a68/bugreport69-5a6a68.phase-inputs.srj.json" with { type: "json" };
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg";

const srj = phaseInputs[0] as SimpleRouteJson;

test("bugreport69-5a6a68 skips out-of-bounds component detection", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  });

  solver.solve();

  expect(solver.solved).toBe(true);
  expect(solver.failed).toBe(false);
  expect(solver.componentDetectionSolver?.getOutput()).toEqual([]);

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
