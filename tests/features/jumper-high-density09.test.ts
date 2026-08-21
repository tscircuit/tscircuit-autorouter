import { test, expect } from "bun:test";
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2";
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints";
import input from "../../fixtures/features/jumper-high-density/jumper-high-density09-input.json" with { type: "json" };

test(
  "HyperJumperPrepatternSolver2_09 - solves high density routes with jumpers",
  () => {
    const nodePortPoints = (input as any[]).flatMap(
      (item: any) => item.nodePortPoints,
    );

    const colorMap: Record<string, string> = {};
    for (const node of nodePortPoints) {
      const nodeColorMap = generateColorMapFromNodeWithPortPoints(node);
      for (const [key, value] of Object.entries(nodeColorMap)) {
        colorMap[key] = value;
      }
    }

    const solver = new HyperJumperPrepatternSolver2({
      nodeWithPortPoints: nodePortPoints[0],
      availableJumperTypes: ["1206x4", "0603"],
      colorMap,
    });

    solver.solve();

    expect(solver.solved || solver.failed).toBe(true);
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path);
  },
  { timeout: 30000 },
);
