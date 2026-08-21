import { test, expect } from "bun:test";
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2";
import input from "../../../fixtures/hyper-jumper-prepattern/hyper-jumper-prepattern03-input.json" with { type: "json" };

test(
  "HyperJumperPrepatternSolver2_03 - solves prepattern routes",
  () => {
    const solver = new HyperJumperPrepatternSolver2({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      traceWidth: input.traceWidth,
      availableJumperTypes: ["1206x4", "0603"],
    });

    solver.solve();

    expect(solver.solved).toBe(true);
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path);
  },
  { timeout: 30_000 },
);
