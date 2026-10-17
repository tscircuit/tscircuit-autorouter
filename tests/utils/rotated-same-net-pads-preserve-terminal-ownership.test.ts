import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("rotated adjacent same-net pads do not relocate each other's terminals", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    allowViaInPad: true,
    minTraceWidth: 0.1524,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [0, 0.635].map((y, index) => ({
      type: "rect",
      center: { x: 0, y },
      width: 0.4,
      height: 1.45,
      ccwRotationDegrees: 90,
      layers: ["bottom"],
      connectedTo: ["ground", "pad-a", "pad-b"],
      circuitJsonMetadata: { pcb_port_id: index === 0 ? "pad-a" : "pad-b" },
    })),
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "bottom",
            pointId: "pad-a",
            pcb_port_id: "pad-a",
          },
          {
            x: 0,
            y: 0.635,
            layer: "bottom",
            pointId: "pad-b",
            pcb_port_id: "pad-b",
          },
        ],
      },
    ],
  }
  const result = addApproximatingRectsToSrj(input)
  expect(result.connections).toEqual(input.connections)
  expect(
    result.obstacles.map(({ center, width, height, ccwRotationDegrees }) => ({
      center,
      width,
      height,
      ccwRotationDegrees,
    })),
  ).toEqual([
    {
      center: { x: 0, y: 0 },
      width: 1.45,
      height: 0.4,
      ccwRotationDegrees: undefined,
    },
    {
      center: { x: 0, y: 0.635 },
      width: 1.45,
      height: 0.4,
      ccwRotationDegrees: undefined,
    },
  ])
})
