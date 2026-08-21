import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver } from "lib";
import bugReport from "../../fixtures/bug-reports/bugreport92-951dfd/bugreport92-951dfd.json" with { type: "json" };
import type { SimpleRouteJson } from "lib/types";
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const srj = bugReport.simple_route_json as SimpleRouteJson;

test(
  "bugreport92-951dfd.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj);
    solver.solve();
    const snapshotPath =
      process.platform === "linux"
        ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
        : import.meta.path;
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath);
  },
  { timeout: 120_000 },
);
