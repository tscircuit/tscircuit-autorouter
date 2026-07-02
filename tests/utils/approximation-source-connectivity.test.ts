import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { isObstacleConnectedToRoute } from "lib/utils/obstacle-connection-identity"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

const assertDefined = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

test("approximated trace obstacle children inherit connectivity through connMap", () => {
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

  const converted = addApproximatingRectsToSrj(srj)
  const child = assertDefined(
    converted.obstacles.find((obstacle) =>
      obstacle.obstacleId?.endsWith("_approx_1"),
    ),
    "Expected an approximation child obstacle",
  )
  const connMap = getConnectivityMapFromSimpleRouteJson(converted)

  expect(child.connectedTo).toEqual(["source_trace_1"])
  expect(connMap.areIdsConnected("source_trace_1", child.obstacleId!)).toBe(
    true,
  )
  expect(
    isObstacleConnectedToRoute(
      child,
      { connectionName: "source_trace_1" },
      connMap,
    ),
  ).toBe(true)
})
