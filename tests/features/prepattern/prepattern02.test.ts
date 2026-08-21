import { test, expect } from "bun:test";
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver";
import input from "../../../fixtures/features/jumper-high-density/jumper-high-density03-input.json" with { type: "json" };

test(
  "JumperPrepatternSolver02 - solves prepattern routes",
  () => {
    const solver = new JumperPrepatternSolver({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      hyperParameters: input.hyperParameters as any,
      traceWidth: input.traceWidth,
    });

    solver.solve();

    expect(solver.solved).toBe(true);
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path);
  },
  { timeout: 30_000 },
);
