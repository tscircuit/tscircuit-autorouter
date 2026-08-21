import { expect, test } from "bun:test";
import type { SimpleRouteJson } from "lib/types";
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj";
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers";

const createSrjWithComponentObstacle = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [
    {
      obstacleId: "pad-1",
      componentId: "U1",
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 1,
      height: 0.5,
      connectedTo: [],
    },
  ],
  connections: [],
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
});

test("SRJ obstacles can include an optional componentId", () => {
  const srj = createSrjWithComponentObstacle();

  expect(srj.obstacles[0]?.componentId).toBe("U1");
});

test("obstacle componentId is preserved by obstacle normalization helpers", () => {
  const srj = createSrjWithComponentObstacle();
  const withZLayers = createObjectsWithZLayers(srj.obstacles, srj.layerCount);
  const approximated = addApproximatingRectsToSrj(srj);

  expect(withZLayers[0]?.componentId).toBe("U1");
  expect(approximated.obstacles[0]?.componentId).toBe("U1");
});
