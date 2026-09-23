import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("exports both path-defined vias when repair omits one from the via list", async (): Promise<void> => {
  const hdRoute: HighDensityRoute = {
    connectionName: "repaired_signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const original = structuredClone(hdRoute)
  const route = convertHdRouteToSimplifiedRoute(hdRoute, 2, {
    defaultViaHoleDiameter: 0.2,
  })
  expect(route.filter((point) => point.route_type === "via")).toEqual([
    { route_type: "via", x: -1, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.2 },
    { route_type: "via", x: 1, y: 0, from_layer: "bottom", to_layer: "top", via_diameter: 0.3, via_hole_diameter: 0.2 },
  ])
  expect(hdRoute).toEqual(original)

  const output: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2.5, maxX: 2.5, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "repaired_signal", connection_name: hdRoute.connectionName, route }],
  }
  const graphics = convertSrjToGraphicsObject(output)
  graphics.texts = [{ x: -2, y: 0.65, text: "TOP -> VIA -> BOTTOM -> VIA -> TOP", fontSize: 0.18, anchorSide: "center_left", color: "black" }]
  await expect(getGraphicsSvgFrames({
    frames: [{ name: "FIXED: both physical layer changes export vias", pipeline: "end", graphics }],
    columns: 1,
    backgroundColor: "white",
  })).toMatchSvgSnapshot(import.meta.path)
})
