import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";
import phaseInputs from "../../fixtures/bug-reports/bugreport70-4e510c/bugreport70-4e510c.phase-inputs.srj.json" with { type: "json" };
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const srj = phaseInputs[0] as SimpleRouteJson;

test("bugreport70-4e510c pipeline7 failure visualization", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  });

  solver.solve();

  expect(solver.solved).toBe(true);
  expect(solver.failed).toBe(false);
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
