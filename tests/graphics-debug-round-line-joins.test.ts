import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("keeps consecutive routed segments in one rounded polyline", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.8,
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1.5, y: 2, layer: "top" },
          { x: 1.5, y: 2, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -2, maxX: 2, minY: -2.5, maxY: 2.5 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace_signal",
        connection_name: "signal",
        route: [
          {
            route_type: "wire",
            x: -1.5,
            y: 2,
            width: 0.8,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 0,
            y: -2,
            width: 0.8,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 1.5,
            y: 2,
            width: 0.8,
            layer: "top",
          },
        ],
      },
    ],
  }

  await expect(convertSrjToGraphicsObject(srj)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
