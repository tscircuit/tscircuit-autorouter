import { expect, test } from "bun:test";
import { getColorMap, safeTransparentize } from "lib/solvers/colors";
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject";
import type { SimpleRouteJson } from "lib/types";

test("colors traces and obstacles by layer and traces by connection in net mode", () => {
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
      {
        type: "rect",
        layers: ["top", "bottom"],
        __zLayers: [1, 2],
        center: { x: 2, y: 3 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top", "inner1", "inner2"],
        __zLayers: [0, 1, 2],
        center: { x: 2, y: 4 },
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
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 5 },
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
  };

  const graphics = convertSrjToGraphicsObject(srj);
  const lineByLayer = new Map(graphics.lines.map((line) => [line.layer, line]));

  expect(lineByLayer.get("z0")?.strokeColor).toBe("red");
  expect(lineByLayer.get("z1")?.strokeColor).toBe("rgba(0,128,0,0.5)");
  expect(lineByLayer.get("z2")?.strokeColor).toBe("rgba(255,255,0,0.5)");
  expect(lineByLayer.get("z3")?.strokeColor).toBe("rgba(0,0,255,0.5)");
  expect(graphics.rects.filter((rect) => rect.center.y === 0)).toMatchObject([
    { layer: "z0", fill: "rgba(255,0,0,0.5)" },
  ]);
  expect(graphics.rects.filter((rect) => rect.center.y === 1)).toMatchObject([
    { layer: "z3", fill: "rgba(0,0,255,0.5)" },
  ]);
  expect(graphics.rects.filter((rect) => rect.center.y === 2)).toMatchObject([
    { layer: "z1", fill: "rgba(255,0,0,0.5)" },
  ]);
  expect(graphics.rects.filter((rect) => rect.center.y === 3)).toMatchObject([
    { layer: "z1,2", fill: "rgba(255,0,0,0.75)" },
  ]);
  expect(graphics.rects.filter((rect) => rect.center.y === 4)).toMatchObject([
    { layer: "z0,1,2", fill: "rgba(255,0,0,0.875)" },
  ]);
  expect(graphics.rects).toHaveLength(5);

  const netGraphics = convertSrjToGraphicsObject(srj, {
    traceColorMode: "net",
  });
  const netLineByLayer = new Map(
    netGraphics.lines.map((line) => [line.layer, line]),
  );
  const colorMap = getColorMap(srj);

  expect(netGraphics.rects).toEqual(graphics.rects);
  expect(netLineByLayer.get("z0")?.strokeColor).toBe(colorMap["top-net"]);
  expect(netLineByLayer.get("z1")?.strokeColor).toBe(
    safeTransparentize(colorMap["inner1-net"]!, 0.5),
  );
  expect(netLineByLayer.get("z2")?.strokeColor).toBe(
    safeTransparentize(colorMap["inner2-net"]!, 0.5),
  );
  expect(netLineByLayer.get("z3")?.strokeColor).toBe(
    safeTransparentize(colorMap["bottom-net"]!, 0.5),
  );
  expect(netGraphics.lines.every((line) => line.label?.endsWith("-net"))).toBe(
    true,
  );
});

test("colors traces on inner layers beyond the fixed palette", () => {
  const srj: SimpleRouteJson = {
    layerCount: 20,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "inner10-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "inner10" },
          { x: 1, y: 0, layer: "inner10" },
        ],
      },
    ],
    bounds: { minX: 0, maxX: 1, minY: -1, maxY: 1 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "inner10-trace",
        connection_name: "inner10-net",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 0,
            width: 0.1,
            layer: "inner10",
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.1,
            layer: "inner10",
          },
        ],
      },
    ],
  };

  const graphics = convertSrjToGraphicsObject(srj);

  expect(graphics.lines).toHaveLength(1);
  expect(graphics.lines[0]).toMatchObject({
    layer: "z10",
    strokeColor: safeTransparentize("hsl(290, 70%, 45%)", 0.5),
  });
});
