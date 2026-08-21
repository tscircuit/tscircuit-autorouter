import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";
import bugReport from "../../fixtures/bug-reports/bugreport75-d7c4d8/bugreport75-d7c4d8.srj.json" with { type: "json" };
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const bugreport75Srj = bugReport as SimpleRouteJson;

test("bugreport75-d7c4d8 pipeline7 connected-net routing", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(bugreport75Srj),
    {
      cacheProvider: null,
    },
  );

  solver.solve();

  expect(solver.solved).toBe(true);
  expect(solver.failed).toBe(false);
  expect(solver.portPointPathingSolver?.solved).toBe(true);
  expect(solver.portPointPathingSolver?.failed).toBe(false);
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { tolerance: 0.4 },
  );
});
