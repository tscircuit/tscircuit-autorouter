import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("keeps near-equal trace widths in one rounded polyline", async () => {
  const srj = {
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
            width: 0.8000003,
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
  } satisfies SimpleRouteJson

  const originalSrj = structuredClone(srj)
  const graphics = convertSrjToGraphicsObject(srj)
  expect(graphics.lines).toHaveLength(1)
  expect(graphics.lines[0]!.points).toHaveLength(3)
  expect(graphics.lines[0]!.strokeWidth).toBe(0.8)
  expect(srj).toEqual(originalSrj)
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)

  srj.traces[0]!.route[1]!.width = 0.4
  const distinctWidths = convertSrjToGraphicsObject(srj)
  expect(distinctWidths.lines.map((line) => line.strokeWidth)).toEqual([
    0.8, 0.4,
  ])
})
