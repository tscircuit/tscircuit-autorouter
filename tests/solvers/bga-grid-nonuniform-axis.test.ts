import { expect, test } from "bun:test";
import { BgaGrid } from "lib/solvers/BgaTopologyGeneratorSolver/bga-grid";
import type { CapacityMeshNode, Obstacle } from "lib/types";
import { areNodesBordering } from "lib/utils/areNodesBordering";

test("BgaGrid keeps observed pad centers while filling missing slots", (): void => {
  const xCoordinates = [0, 0.8, 1.599, 2.401];
  const yCoordinates = [0, 0.799, 3.201];
  const obstacles: Obstacle[] = yCoordinates.flatMap((y, row) =>
    xCoordinates.map((x, col) => ({
      componentId: "bga",
      obstacleId: `pad_${row}_${col}`,
      type: "rect",
      layers: ["top"],
      center: { x, y },
      width: 0.45,
      height: 0.45,
      connectedTo: [],
    })),
  );
  const grid = BgaGrid.fromObstacles(obstacles)!;
  const targetObstacle = obstacles.find(
    (obstacle) => obstacle.center.x === 1.599 && obstacle.center.y === 0.799,
  )!;
  const targetSlot = grid.getSlotForObstacle(targetObstacle)!;
  const verticalGap = grid.getVerticalGap(targetSlot.row, targetSlot.col);
  const targetNode: CapacityMeshNode = {
    capacityMeshNodeId: "target",
    center: targetObstacle.center,
    width: targetObstacle.width,
    height: targetObstacle.height,
    availableZ: [0],
    layer: "z0",
  };
  const gapNode: CapacityMeshNode = {
    capacityMeshNodeId: "gap",
    center: verticalGap.center,
    width: verticalGap.width,
    height: verticalGap.height,
    availableZ: [0],
    layer: "z0",
  };

  expect(grid.slots.size).toBe(obstacles.length);
  expect(grid.getSlotCenter(targetSlot.row, targetSlot.col)).toEqual(
    targetObstacle.center,
  );
  expect(areNodesBordering(targetNode, gapNode)).toBe(true);
});
