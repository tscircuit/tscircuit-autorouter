import { expect, test } from "bun:test";
import keyboard4 from "../fixtures/legacy/assets/keyboard4.json" with { type: "json" };
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache";
import { prepareParamsForDownload } from "lib/testing/utils/prepareParamsForDownload";
import type { SimpleRouteJson } from "lib/types";

test.skip("keyboard4 pipeline5 portPointPathing input can be prepared and stringified for download", async () => {
  const solver = new AutoroutingPipelineSolver5(
    structuredClone(keyboard4 as SimpleRouteJson),
  );

  while (!solver.failed && !solver.solved) {
    await solver.stepAsync();
    if (solver.portPointPathingSolver) {
      break;
    }
  }

  const portPointPathingStep = solver.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  );
  expect(portPointPathingStep).toBeDefined();

  const params = portPointPathingStep!.getConstructorParams(solver);
  const prepared = prepareParamsForDownload(params);
  const json = JSON.stringify(prepared);

  expect(json.length).toBeGreaterThan(0);
  expect(json.length).toBeLessThan(100_000_000);
  expect(json).toContain(
    '"format":"serialized-hg-port-point-pathing-solver-params"',
  );
});
