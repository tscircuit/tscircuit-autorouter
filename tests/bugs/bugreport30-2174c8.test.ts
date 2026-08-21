import { expect, test } from "bun:test";
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2";
import bugReport from "../../fixtures/bug-reports/bugreport30-2174c8/bugreport30-2174c8.json" with { type: "json" };
import type { SimpleRouteJson } from "lib/types";
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const srj = bugReport.simple_route_json as SimpleRouteJson;

test.skip(
  "bugreport30-2174c8",
  () => {
    const solver = new AssignableAutoroutingPipeline2(srj);
    solver.solve();
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    );
  },
  { timeout: 180_000 },
);
