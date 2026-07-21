import { expect, test } from "bun:test"
import { getColorMap, safeTransparentize } from "lib/solvers/colors"
import {
  convertSrjToGraphicsObject,
  getGraphicsColorForLayers,
} from "lib/utils/convertSrjToGraphicsObject"
import type { SimpleRouteJson } from "lib/types"

test("colors wire segments by layer by default and by connection in net mode", () => {
  expect(getGraphicsColorForLayers(["top", "bottom"])).toBe("gray")
  expect(() => getGraphicsColorForLayers(["top", "bogus"])).toThrow(
    'No visualization color for layer "bogus"',
  )

  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 2, y: 1 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["inner1"],
        center: { x: 2, y: 2 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "top-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "bottom-net",
        pointsToConnect: [
          { x: 0, y: 1, layer: "bottom" },
          { x: 1, y: 1, layer: "bottom" },
        ],
      },
      {
        name: "inner1-net",
        pointsToConnect: [
          { x: 0, y: 2, layer: "inner1" },
          { x: 1, y: 2, layer: "inner1" },
        ],
      },
      {
        name: "inner2-net",
        pointsToConnect: [
          { x: 0, y: 3, layer: "inner2" },
          { x: 1, y: 3, layer: "inner2" },
        ],
      },
    ],
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 4 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "top-trace",
        connection_name: "top-net",
        route: [
          { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "bottom-trace",
        connection_name: "bottom-net",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 1,
            width: 0.15,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: 1,
            y: 1,
            width: 0.15,
            layer: "bottom",
          },
          {
            route_type: "via",
            x: 1,
            y: 1,
            from_layer: "bottom",
            to_layer: "inner1",
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "inner1-trace",
        connection_name: "inner1-net",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 2,
            width: 0.15,
            layer: "inner1",
          },
          {
            route_type: "wire",
            x: 1,
            y: 2,
            width: 0.15,
            layer: "inner1",
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "inner2-trace",
        connection_name: "inner2-net",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 3,
            width: 0.15,
            layer: "inner2",
          },
          {
            route_type: "wire",
            x: 1,
            y: 3,
            width: 0.15,
            layer: "inner2",
          },
        ],
      },
    ],
  }

  const graphics = convertSrjToGraphicsObject(srj)
  const lineByLayer = new Map(graphics.lines.map((line) => [line.layer, line]))
  const pointByLayer = new Map(
    graphics.points.map((point) => [point.layer, point]),
  )
  const rectByLayer = new Map(graphics.rects.map((rect) => [rect.layer, rect]))

  expect(lineByLayer.get("z0")?.strokeColor).toBe("red")
  expect(lineByLayer.get("z1")?.strokeColor).toBe("gray")
  expect(lineByLayer.get("z2")?.strokeColor).toBe("gray")
  expect(lineByLayer.get("z3")?.strokeColor).toBe("blue")
  expect(pointByLayer.get("z0")?.color).toBe("red")
  expect(pointByLayer.get("z1")?.color).toBe("gray")
  expect(pointByLayer.get("z2")?.color).toBe("gray")
  expect(pointByLayer.get("z3")?.color).toBe("blue")
  expect(rectByLayer.get("z0")?.fill).toBe("rgba(255,0,0,0.5)")
  expect(rectByLayer.get("z1")?.fill).toBe("rgba(128,128,128,0.5)")
  expect(rectByLayer.get("z3")?.fill).toBe("rgba(0,0,255,0.5)")
  expect(graphics.circles[0]?.fill).toBe("gray")

  const netGraphics = convertSrjToGraphicsObject(srj, {
    traceColorMode: "net",
  })
  const netLineByLayer = new Map(
    netGraphics.lines.map((line) => [line.layer, line]),
  )
  const colorMap = getColorMap(srj)

  expect(netLineByLayer.get("z0")?.strokeColor).toBe(colorMap["top-net"])
  expect(netLineByLayer.get("z1")?.strokeColor).toBe(
    safeTransparentize(colorMap["inner1-net"]!, 0.5),
  )
  expect(netLineByLayer.get("z2")?.strokeColor).toBe(
    safeTransparentize(colorMap["inner2-net"]!, 0.5),
  )
  expect(netLineByLayer.get("z3")?.strokeColor).toBe(
    safeTransparentize(colorMap["bottom-net"]!, 0.5),
  )
  expect(netGraphics.points[0]?.color).toBe(colorMap["top-net"])
  expect(netGraphics.circles[0]?.fill).toBe(colorMap["bottom-net"])
  expect(netGraphics.lines.every((line) => line.label?.endsWith("-net"))).toBe(
    true,
  )
})
