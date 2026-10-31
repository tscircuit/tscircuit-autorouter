import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("preserves terminals beside a rotated pad on the same net", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "first" },
          { x: 0, y: 0.635, layer: "bottom", pcb_port_id: "second" },
        ],
      },
    ],
    obstacles: [0, 0.635].map((y) => ({
      type: "rect",
      center: { x: 0, y },
      width: 0.4,
      height: 1.45,
      ccwRotationDegrees: 90,
      layers: ["bottom"],
      connectedTo: ["first", "second", "ground"],
    })),
  }
  const originalPoints = structuredClone(srj.connections[0]!.pointsToConnect)
  const processed = addApproximatingRectsToSrj(srj)
  expect(processed.connections[0]!.pointsToConnect).toEqual(originalPoints)
  expect(srj.connections[0]!.pointsToConnect).toEqual(originalPoints)
})
