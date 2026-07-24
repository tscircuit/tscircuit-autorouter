import { expect, test } from "bun:test"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/create-stitch-segment-validator"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitch validation recognizes a derived route's root-net obstacle", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "source_trace_8__source_net_8_mst3",
    rootConnectionName: "source_trace_8",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0.3, z: 0 },
    ],
    vias: [],
  }
  const router = createStitchSegmentRouter({
    hdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["source_trace_8"],
      },
    ],
    layerCount: 1,
    minClearance: 0.2,
  })

  expect(
    router.isValidSegment({
      connectionName: route.connectionName,
      start: { x: 0, y: 0.3, z: 0 },
      end: { x: 0, y: 0, z: 0 },
      traceThickness: route.traceThickness,
    }),
  ).toBe(true)
})
