import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"

test("trace simplification derives vias and clears stale through-obstacle markers", () => {
  const solver = new TraceSimplificationSolver({
    hdRoutes: [
      {
        connectionName: "P",
        traceThickness: 0.2,
        viaDiameter: 0.5,
        route: [
          { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
          { x: 1, y: 1, z: 0 },
          { x: 1.125, y: 1.25, z: 0 },
          { x: 1.125, y: 1.25, z: 1 },
        ],
        vias: [{ x: 99, y: 99 }],
      },
    ],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.5,
    layerCount: 2,
  })

  const [route] = solver.simplifiedHdRoutes
  expect(route!.route[0]!.toNextSegmentType).toBeUndefined()
  expect(route!.vias).toEqual([{ x: 1.125, y: 1.25 }])
})
