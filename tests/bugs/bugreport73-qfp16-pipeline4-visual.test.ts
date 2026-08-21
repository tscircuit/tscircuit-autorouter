import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph";
import type { SimpleRouteJson } from "lib/types";
import srj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with { type: "json" };
import { getLastStepSvg } from "../fixtures/getLastStepSvg";

const bugreport73Qfp16Srj = srj as SimpleRouteJson;

test("bugreport73 qfp16 pipeline4 visual snapshot", (): void => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(bugreport73Qfp16Srj),
    {
      cacheProvider: null,
    },
  );

  solver.solve();

  expect(solver.solved).toBe(true);
  expect(solver.failed).toBe(false);
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  );
});
