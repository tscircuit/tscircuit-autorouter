import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver } from "lib";
import bugReport from "../../fixtures/bug-reports/bugreport10-71239a/bugreport10-71239a.json" with { type: "json" };
import type { SimpleRouteJson } from "lib/types";
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const srj = bugReport.simple_route_json as SimpleRouteJson;

test("solve even when we have gaps between collision nodes and straw nodes", () => {
  const solver = new AutoroutingPipelineSolver(srj);
  solver.solve();
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
