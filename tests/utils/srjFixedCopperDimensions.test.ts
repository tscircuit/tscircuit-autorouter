import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import {
  fixedCopperSrj,
  obstacleContainsPoint,
} from "tests/fixtures/srj-fixed-copper"

test("fixed copper preserves tiny segments, wider ends, explicit via spans and ownership", () => {
  const srj: SimpleRouteJson = {
    ...fixedCopperSrj,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "tiny_trace",
        connection_name: "TINY",
        connectsTo: ["PAD"],
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
          { route_type: "wire", x: 0.0004, y: 0, layer: "top", width: 0.6 },
          { route_type: "wire", x: 0.0004, y: 0, layer: "top", width: 0.6 },
          {
            route_type: "via",
            x: 0.0004,
            y: 0,
            from_layer: "top",
            to_layer: "inner1",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.8,
          },
        ],
      },
    ],
  }
  const before = JSON.stringify(srj)
  const obstacles = getObstaclesFromSrjTraces(srj)
  expect(
    obstacles.every((obstacle) => obstacle.width > 0 && obstacle.height > 0),
  ).toBe(true)
  expect(
    obstacles.every((obstacle) =>
      ["TINY", "tiny_trace", "PAD"].every((id) =>
        obstacle.connectedTo.includes(id),
      ),
    ),
  ).toBe(true)
  const wires = obstacles.filter((obstacle) => obstacle.layers.length === 1)
  expect(
    wires.some((obstacle) =>
      obstacleContainsPoint(obstacle, { x: -0.29, y: 0 }),
    ),
  ).toBe(true)
  expect(
    wires.some((obstacle) =>
      obstacleContainsPoint(obstacle, { x: 0.0004, y: 0.29 }),
    ),
  ).toBe(true)
  expect(
    wires.some((obstacle) =>
      obstacleContainsPoint(obstacle, { x: -0.29, y: 0.29 }),
    ),
  ).toBe(false)
  const via = obstacles.find((obstacle) => obstacle.obstacleId?.endsWith("_via"))!
  expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  expect(via.shape).toBe("circle")
  expect(JSON.stringify(srj)).toBe(before)
})
