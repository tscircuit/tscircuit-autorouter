import { expect, test } from "bun:test"
import { getLengthMatchingPreloadedTraceObstacles } from "lib/solvers/getLengthMatchingPreloadedTraceObstacles"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("materializes preloaded copper with complete net aliases", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.08,
    minViaHoleDiameter: 0.15,
    minViaPadDiameter: 0.25,
    obstacles: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "DDR_DQ9",
        pointsToConnect: [
          { x: -2, y: -2, layer: "bottom", pointId: "left-exit" },
          { x: 2, y: 2, layer: "bottom", pointId: "right-exit" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "left-prefix",
        connection_name: "left-breakout",
        connectsTo: ["left-pad", "left-exit"],
        route: [
          {
            route_type: "wire",
            x: -3,
            y: -3,
            width: 0.08,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: -2,
            y: -2,
            width: 0.08,
            layer: "bottom",
          },
          {
            route_type: "via",
            x: -2,
            y: -2,
            from_layer: "bottom",
            to_layer: "inner2",
            via_diameter: 0.25,
            via_hole_diameter: 0.15,
          },
        ],
      },
    ],
  }
  const obstacles = getLengthMatchingPreloadedTraceObstacles({
    srj,
    traces: srj.traces!,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })

  expect(obstacles.length).toBeGreaterThanOrEqual(3)
  expect(obstacles.every((obstacle) => !obstacle.ccwRotationDegrees)).toBe(true)
  expect(
    obstacles.every(
      (obstacle) =>
        obstacle.connectedTo.includes("DDR_DQ9") &&
        obstacle.connectedTo.includes("left-breakout") &&
        obstacle.connectedTo.includes("left-exit"),
    ),
  ).toBe(true)
  expect(
    obstacles.some(
      (obstacle) =>
        obstacle.layers.includes("inner2") &&
        obstacle.width === 0.25 &&
        obstacle.height === 0.25,
    ),
  ).toBe(true)
})
