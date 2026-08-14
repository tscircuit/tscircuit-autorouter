import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("repro: four-layer output can only emit blind and buried via spans", () => {
  const highDensityRoute: HighDensityIntraNodeRoute = {
    connectionName: "SIGNAL",
    traceThickness: 0.15,
    viaDiameter: 0.45,
    route: [
      { x: -3, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const route = convertHdRouteToSimplifiedRoute(highDensityRoute, 4)
  const viaSpans = route
    .filter((segment) => segment.route_type === "via")
    .map((via) => [via.from_layer, via.to_layer])

  expect(viaSpans).toEqual([
    ["top", "inner1"],
    ["inner1", "inner2"],
  ])

  const output: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.3,
    obstacles: [],
    connections: [],
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_signal",
        connection_name: "SIGNAL",
        route,
      },
    ],
  }

  expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
