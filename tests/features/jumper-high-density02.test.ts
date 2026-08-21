import { test, expect } from "bun:test";
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers";
import input from "../../fixtures/features/jumper-high-density/jumper-high-density02-input.json" with { type: "json" };

test("IntraNodeSolverWithJumpers02 - solves high density routes with jumpers", () => {
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: input.hyperParameters,
    traceWidth: input.traceWidth,
  });

  solver.solve();

  expect(solver.solved || solver.failed).toBe(true);
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path);
});
