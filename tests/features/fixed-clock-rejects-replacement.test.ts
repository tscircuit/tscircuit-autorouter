import { expect, test } from "bun:test"
import { FinalRouteConstraintsSolver } from "lib/solvers/ConstrainedRouteSolver/FinalRouteConstraintsSolver"
import type { SimpleRouteJson } from "lib/types"

test("an over-budget fixed clock fails instead of being replaced", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "clock",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 4, y: 0, layer: "top", pointId: "b" },
        ],
      },
    ],
    routeConstraints: [
      {
        name: "clock-rule",
        connectionName: "clock",
        sourceTraceId: "clock-rule",
        pointIds: ["a", "b"],
        maxViaCount: 0,
        maxLength: 6,
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-clock",
        connection_name: "clock",
        isFixed: true,
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
          {
            route_type: "via",
            x: 2,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.1 },
          { route_type: "wire", x: 4, y: 0, layer: "bottom", width: 0.1 },
        ],
      },
    ],
  }
  const final = new FinalRouteConstraintsSolver(input, input.traces!)
  final.solve()
  expect(final.solved).toBe(false)
  expect(final.failed).toBe(true)
  expect(final.error).toBe(
    "Cannot replace fixed copper for clock-rule to satisfy its via/length limits",
  )
  expect(final.traces).toEqual(input.traces!)
})
