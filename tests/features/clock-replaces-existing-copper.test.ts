import { expect, test } from "bun:test"
import { ConstrainedRouteSolver } from "lib/solvers/ConstrainedRouteSolver/ConstrainedRouteSolver"
import { FinalRouteConstraintsSolver } from "lib/solvers/ConstrainedRouteSolver/FinalRouteConstraintsSolver"
import type { SimpleRouteJson } from "lib/types"

test("an over-budget preloaded clock is replaced without adding a parallel path", (): void => {
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
        pcb_trace_id: "old-clock",
        connection_name: "clock",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
          {
            route_type: "via",
            x: 1,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.1 },
          { route_type: "wire", x: 3, y: 0, layer: "bottom", width: 0.1 },
          {
            route_type: "via",
            x: 3,
            y: 0,
            from_layer: "bottom",
            to_layer: "top",
          },
          { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const original = structuredClone(input)
  const reservation = new ConstrainedRouteSolver(input)
  reservation.solve()
  expect(reservation.outputSrj.traces).toEqual(input.traces)
  const final = new FinalRouteConstraintsSolver(
    input,
    reservation.outputSrj.traces!,
  )
  final.solve()
  expect(final.solved).toBe(true)
  expect(final.traces).toHaveLength(1)
  expect(final.traces[0]!).toMatchObject({
    pcb_trace_id: "old-clock",
    __replaces_pcb_trace_id: "old-clock",
  })
  expect(
    final.traces[0]!.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(0)
  expect(input).toEqual(original)
})
