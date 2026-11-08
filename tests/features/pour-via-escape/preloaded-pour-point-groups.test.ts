import { expect, test } from "bun:test"
import { getConnectedCopperPourObstacles } from "lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourObstacles"
import { getPreloadedPourPointGroups } from "lib/solvers/EscapeViaLocationSolver/getPreloadedPourPointGroups"
import type { SimpleRouteJson } from "lib/types"

test("retained vias join only physically connected terminals to their plane island", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [-2, 2].map((x) => ({
      type: "rect",
      isCopperPour: true,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layers: ["inner1"],
      connectedTo: ["GND"],
    })),
    connections: [
      {
        name: "GND",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "routed" },
          { x: -2, y: 0.5, layer: "top", pointId: "branch" },
          { x: 2, y: 0, layer: "top", pointId: "unrouted" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "retained",
        connection_name: "earlier_phase_ground",
        connectsTo: ["routed", "old_escape_id"],
        route: [
          { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
          { route_type: "wire", x: -2, y: 0.2, layer: "top", width: 0.1 },
          {
            route_type: "via",
            x: -2,
            y: 0.2,
            from_layer: "top",
            to_layer: "inner1",
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "retained_branch",
        connection_name: "earlier_phase_ground",
        connectsTo: ["branch", "routed"],
        route: [
          { route_type: "wire", x: -2, y: 0.5, layer: "top", width: 0.1 },
          { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const original = structuredClone(srj)
  const evaluate = (input: SimpleRouteJson): Map<object, string[]> =>
    getPreloadedPourPointGroups({
      srj: input,
      points: input.connections[0]!.pointsToConnect,
      matchingPours: input.obstacles,
      connectedPourByObstacle: getConnectedCopperPourObstacles(input.obstacles),
    })
  expect(evaluate(srj).get(srj.obstacles[0]!)).toEqual(["routed", "branch"])
  expect(evaluate(srj).has(srj.obstacles[1]!)).toBeFalse()
  expect(srj).toEqual(original)
  for (const variant of [
    "no-via",
    "wrong-layer",
    "outside-plane",
    "unattached",
  ] as const) {
    const input = structuredClone(srj)
    const trace = input.traces![0]!
    const via = trace.route[2]!
    if (via.route_type !== "via") throw new Error("Expected fixture via")
    if (variant === "no-via") trace.route.pop()
    if (variant === "wrong-layer") {
      input.allowBlindAndBuriedVias = true
      via.from_layer = "inner2"
      via.to_layer = "bottom"
    }
    if (variant === "outside-plane") via.x = 0
    if (variant === "unattached")
      trace.connectsTo = ["other_terminal", "old_escape_id"]
    expect(evaluate(input).size).toBe(0)
  }
})
