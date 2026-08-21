import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache";
import { prepareParamsForDownload } from "lib/testing/utils/prepareParamsForDownload";
import type { SimpleRouteJson } from "lib/types";
import srj from "./repro/dip16-basic.json" with { type: "json" };

test.skip("sanitizeParamsForDownload makes pipeline5 portPointPathing input JSON serializable", async () => {
  const solver = new AutoroutingPipelineSolver5(
    structuredClone(srj as SimpleRouteJson),
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
  const sanitized = prepareParamsForDownload(params);
  const serialized = JSON.stringify(sanitized, null, 2);

  expect(serialized.length).toBeGreaterThan(0);
  expect(serialized).toContain(
    '"format": "serialized-hg-port-point-pathing-solver-params"',
  );
  expect(() => JSON.parse(serialized)).not.toThrow();
});
