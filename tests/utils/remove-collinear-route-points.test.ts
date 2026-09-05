import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { removeCollinearRoutePoints } from "lib/utils/removeCollinearRoutePoints"

test("collinear cleanup removes burrs while preserving route anchors and copper metadata", () => {
  const hdRoute: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: -1, y: 2, z: 0 },
    ],
  }
  expect(removeCollinearRoutePoints(hdRoute)).toEqual([
    hdRoute.route[0],
    hdRoute.route[1],
    hdRoute.route[4],
    hdRoute.route[5],
  ])
  const anchors: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0, pcb_port_id: "pad" },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 0, z: 1, traceThickness: 0.2 },
      { x: 6, y: 0, z: 1, toNextSegmentType: "through_obstacle" },
      { x: 7, y: 0, z: 1 },
      { x: 8, y: 0, z: 1 },
    ],
    vias: [{ x: 2, y: 0 }],
    jumpers: [
      {
        route_type: "jumper",
        start: { x: 3, y: 0 },
        end: { x: 4, y: 0 },
        footprint: "0603",
      },
    ],
  }
  expect(removeCollinearRoutePoints(anchors)).toEqual(anchors.route)
  expect(hdRoute.route).toHaveLength(6)
})
