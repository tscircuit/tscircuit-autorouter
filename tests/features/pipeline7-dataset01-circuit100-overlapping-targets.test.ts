import { expect, test } from "bun:test";
import * as dataset01 from "@tscircuit/autorouting-dataset-01";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";

test("pipeline7 dataset01 circuit100 keeps overlapping targets reachable", (): void => {
  const circuit100 = (dataset01 as Record<string, unknown>)
    .circuit100 as SimpleRouteJson;
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit100),
    { effort: 0.1, cacheProvider: null },
  );

  solver.solveUntilPhase("portPointPathingSolver");
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed
  ) {
    solver.step();
  }

  expect(solver.getCurrentPhase()).toBe("uniformPortDistributionSolver");
  expect(solver.failed).toBe(false);
  expect(solver.portPointPathingSolver?.failed).toBe(false);
  expect(solver.portPointPathingSolver?.solved).toBe(true);
  expect(
    solver.portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0);
});
