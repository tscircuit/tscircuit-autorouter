import { expect, test } from "bun:test"
import { getUnownedObstacleDrcErrors } from "lib/testing/getUnownedObstacleDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("unowned barrier DRC uses the board layer normalization without losing physical barriers", (): void => {
  const traces: SimplifiedPcbTrace[] = ["top", "bottom"].map((layer) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace-${layer}`,
    connection_name: `signal-${layer}`,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer },
    ],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: traces.map((trace) => ({
      name: trace.connection_name,
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1.5, y: 1.5 },
        width: 0.1,
        height: 0.1,
        connectedTo: ["declared-owner"],
      },
      {
        obstacleId: "opaque-barrier",
        type: "rect",
        // Dataset01 circuit003 retains these legacy stack-wide layer names.
        layers: ["top", "inner1", "inner2", "bottom"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
    ],
  }
  const original = structuredClone({ srj, traces })
  const check = (
    board: SimpleRouteJson,
    routes: SimplifiedPcbTrace[],
  ): ReturnType<typeof getUnownedObstacleDrcErrors> => {
    return getUnownedObstacleDrcErrors({
      inputSrj: board,
      jointTraces: routes,
      circuitJson: convertToCircuitJson(board, routes),
    })
  }

  const errors = check(srj, traces)
  expect(errors).toHaveLength(2)
  expect(errors.map((error) => error.pcb_trace_id).sort()).toEqual([
    "trace-bottom",
    "trace-top",
  ])
  for (const error of errors) {
    expect(error.srj_obstacle_index).toBe(1)
    expect(error.srj_obstacle_id).toBe("opaque-barrier")
    expect(error.minimum_clearance).toBe(0)
    expect(error.actual_clearance).toBeLessThan(0)
  }

  const explicitBottom = structuredClone(srj)
  explicitBottom.obstacles[1]!.zLayers = [1]
  expect(
    check(explicitBottom, traces).map((error) => error.pcb_trace_id),
  ).toEqual(["trace-bottom"])
  const canonicalTop = structuredClone(explicitBottom)
  canonicalTop.obstacles[1]!.__zLayers = [0]
  expect(
    check(canonicalTop, traces).map((error) => error.pcb_trace_id),
  ).toEqual(["trace-top"])

  const fourLayerBoard = structuredClone(srj)
  fourLayerBoard.layerCount = 4
  fourLayerBoard.obstacles[1]!.layers = ["inner2"]
  const innerTrace: SimplifiedPcbTrace = {
    ...traces[0]!,
    pcb_trace_id: "trace-inner2",
    route: traces[0]!.route.map((point) => ({ ...point, layer: "inner2" })),
  }
  const innerErrors = check(fourLayerBoard, [...traces, innerTrace])
  expect(innerErrors.map((error) => error.pcb_trace_id)).toEqual([
    "trace-inner2",
  ])
  expect(innerErrors[0]!.srj_obstacle_index).toBe(1)

  const invalidBoard = structuredClone(srj)
  invalidBoard.obstacles[1]!.layers = ["inner8"]
  expect(() => check(invalidBoard, traces)).toThrow(
    'Obstacle "opaque-barrier" has no layers on this 2-layer board',
  )
  expect({ srj, traces }).toEqual(original)
})
