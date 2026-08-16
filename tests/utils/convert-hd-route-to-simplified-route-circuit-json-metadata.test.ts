import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("preserves Circuit JSON metadata on through-obstacle route points", () => {
  const solver = new TraceSimplificationSolver({
    hdRoutes: [
      {
        connectionName: "trace_1",
        traceThickness: 0.2,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["trace_1"],
        circuitJsonMetadata: { pcb_via_id: "opaque-via-id" },
      },
    ],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.6,
    layerCount: 2,
  })

  const route = convertHdRouteToSimplifiedRoute(
    solver.simplifiedHdRoutes[0]!,
    2,
  )
  const throughObstacle = route.find(
    (routePoint) => routePoint.route_type === "through_obstacle",
  )

  expect(throughObstacle).toMatchObject({
    route_type: "through_obstacle",
    circuitJsonMetadata: { pcb_via_id: "opaque-via-id" },
  })
})
