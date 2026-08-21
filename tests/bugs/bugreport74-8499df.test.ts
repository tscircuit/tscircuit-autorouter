import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";
import phaseSrjs from "../../fixtures/bug-reports/bugreport74-8499df/bugreport74-8499df.srj.json" with { type: "json" };
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const parentBoardSrj = phaseSrjs[1] as SimpleRouteJson;

test("bugreport74-8499df fanout board routing", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(parentBoardSrj, {
    cacheProvider: null,
  });

  solver.solve();

  expect(solver.solved).toBe(true);
  expect(solver.failed).toBe(false);
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
