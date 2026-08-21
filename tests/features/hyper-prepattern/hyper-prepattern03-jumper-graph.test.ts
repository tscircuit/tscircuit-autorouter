import { test, expect } from "bun:test";
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2";
import input from "../../../fixtures/hyper-jumper-prepattern/hyper-jumper-prepattern03-input.json" with { type: "json" };

test("HyperJumperPrepatternSolver2_03 - visualize JumperGraphSolver input/output", () => {
  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    traceWidth: input.traceWidth,
    availableJumperTypes: ["1206x4", "0603"],
  });

  solver.solve();

  expect(solver.solved).toBe(true);

  // Access the winning solver's internal JumperGraphSolver
  const winningSolver = solver.winningSolver;
  expect(winningSolver).toBeDefined();

  const jumperGraphSolver = winningSolver!.jumperGraphSolver;
  expect(jumperGraphSolver).toBeDefined();

  // Visualize the JumperGraphSolver's internal state
  const jumperGraphVisualization = jumperGraphSolver!.visualize();
  expect(jumperGraphVisualization).toMatchGraphicsSvg(import.meta.path);
});
