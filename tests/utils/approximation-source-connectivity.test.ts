import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { ObstacleConnectionIdentity } from "lib/utils/ObstacleConnectionIdentity"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

const assertDefined = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

test("approximated trace obstacle children keep ownership separate from connection anchors", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "trace_obstacle_source_trace_1_0_0_wire",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 10,
        height: 0.2,
        ccwRotationDegrees: 45,
        connectedTo: ["source_trace_1"],
      },
    ],
    connections: [],
  }
  const connMap = {
    areIdsConnected: (left: string, right: string) =>
      left === right ||
      (left === "source_trace_1" && right === "source_trace_1"),
  }

  const converted = addApproximatingRectsToSrj(srj)
  const disconnectedChild = converted.obstacles.find(
    (obstacle) => obstacle.connectedTo.length === 0,
  )
  const child = assertDefined(
    disconnectedChild,
    "Expected an approximation child without direct connectedTo",
  )
  const approximationSource = assertDefined(
    child.approximationSource,
    "Expected approximation child to carry source ownership",
  )

  expect(approximationSource.connectedTo).toEqual(["source_trace_1"])
  expect(
    ObstacleConnectionIdentity.fromObstacle(child).isConnectedToRoute(
      { connectionName: "source_trace_1" },
      connMap,
    ),
  ).toBe(false)
  expect(
    ObstacleConnectionIdentity.fromObstacle(child).isOwnedByRoute(
      { connectionName: "source_trace_1" },
      connMap,
    ),
  ).toBe(true)
})
