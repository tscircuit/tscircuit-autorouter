import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("addApproximatingRectsToSrj synthesizes a parent obstacle id for connected rotated obstacles without ids", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 3.2,
        height: 1.25,
        ccwRotationDegrees: 45,
        connectedTo: ["source_trace_0", "pcb_port_0"],
      },
    ],
    connections: [
      {
        name: "source_trace_0",
        pointsToConnect: [
          {
            x: 0.25,
            y: 0.25,
            layer: "top",
            pointId: "pcb_port_0",
            pcb_port_id: "pcb_port_0",
          },
          {
            x: 3,
            y: 3,
            layer: "top",
          },
        ],
      },
    ],
  }

  const converted = addApproximatingRectsToSrj(srj)
  const parentObstacle = converted.obstacles.find(
    (obstacle) => obstacle.connectedTo.length > 0,
  )

  expect(parentObstacle?.obstacleId).toBe("connected_obstacle_0")
  expect(
    converted.obstacles.some(
      (obstacle) => obstacle.parentObstacleId === "connected_obstacle_0",
    ),
  ).toBe(true)
})
