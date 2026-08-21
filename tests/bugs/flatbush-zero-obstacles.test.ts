import { test, expect } from "bun:test";
import { ObstacleSpatialHashIndex } from "../../lib/data-structures/ObstacleTree";

test("flatbush index handles zero obstacles", () => {
  const idx = new ObstacleSpatialHashIndex("flatbush", []);
  const result = idx.searchArea(0, 0, 1, 1);
  expect(result.length).toBe(0);
});
