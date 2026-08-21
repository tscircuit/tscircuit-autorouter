import { expect, test } from "bun:test";
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2";
import bugReport from "../../fixtures/bug-reports/bugreport27-dd3734/bugreport27-dd3734.json" with { type: "json" };
import type { SimpleRouteJson } from "lib/types";
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const srj = bugReport.simple_route_json as SimpleRouteJson;

test.skip("bugreport27-dd3734", () => {
  const portPointWinningHyperParameters = {
    NODE_PF_FACTOR: 10000,
    FORCE_OFF_BOARD_FREQUENCY: 0.3,
    CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
    FORCE_CENTER_FIRST: true,
    SHUFFLE_SEED: 2139,
    MIN_ALLOWED_BOARD_SCORE: -1,
  };

  const solver = new AssignableAutoroutingPipeline2(srj);

  // // solve until the high density route solver, take a snapshot of the
  // // visualization from the port point pathing solver
  // solver.solveUntilPhase("simpleHighDensityRouteSolver")

  // expect(
  //   getLastStepSvg(solver.portPointPathingSolver!.visualize()),
  // ).toMatchSvgSnapshot(import.meta.path, {
  //   svgName: "bugreport27-portPointPathingSolver",
  // })

  solver.solve();
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
