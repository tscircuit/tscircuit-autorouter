import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios";

test("pipeline7 keeps srj24 sample006 polygon pad fragments reachable", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 6, 0.1);
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  });

  solver.solveUntilPhase("portPointPathingSolver");
  solver.step();
  solver.step();
  solver.step();

  expect(solver.failed).toBe(false);
  expect(solver.portPointPathingSolver?.failed).toBe(false);
  expect(
    solver.portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0);
});
