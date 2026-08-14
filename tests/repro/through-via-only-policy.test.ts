import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("through-via-only policy expands every generated via to the board stack", () => {
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
  const route = convertHdRouteToSimplifiedRoute(highDensityRoute, 4, {
    viaSpanPolicy: "through_only",
  })
  const viaSpans = route
    .filter((segment) => segment.route_type === "via")
    .map((via) => [via.from_layer, via.to_layer])

  expect(viaSpans).toEqual([
    ["top", "bottom"],
    ["top", "bottom"],
  ])
  const terminalViaRoute = convertHdRouteToSimplifiedRoute(
    {
      connectionName: "TERMINAL_SIGNAL",
      traceThickness: 0.15,
      viaDiameter: 0.45,
      route: [
        { x: -3, y: -1, z: 1 },
        { x: 3, y: -1, z: 1 },
      ],
      vias: [],
    },
    4,
    {
      connectionPoints: [
        {
          x: -3,
          y: -1,
          layer: "inner1",
          terminalVia: { toLayer: "top" },
        },
      ],
      viaSpanPolicy: "through_only",
    },
  )
  expect(
    terminalViaRoute.find((segment) => segment.route_type === "via"),
  ).toMatchObject({ from_layer: "top", to_layer: "bottom" })

  const output: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.3,
    viaSpanPolicy: "through_only",
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

  const graphics = {
    ...convertSrjToGraphicsObject(output),
    texts: route.flatMap((segment) =>
      segment.route_type === "via"
        ? [
            {
              x: segment.x,
              y: 0.8,
              text: `${segment.from_layer} -> ${segment.to_layer}`,
              anchorSide: "center" as const,
              fontSize: 0.25,
              color: "black",
            },
          ]
        : [],
    ),
  }
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
