import { expect, test } from "bun:test"
import { isConnectionPointOnObstacle } from "lib/solvers/BgaTopologyGeneratorSolver/isConnectionPointOnObstacle"
import type { ConnectionPoint, Obstacle } from "lib/types"

test(
  "rotated target pads require physical contact on a copper layer despite net aliases",
  (): void => {
    const obstacle: Obstacle = {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 4,
      height: 1,
      ccwRotationDegrees: 90,
      layers: ["bottom"],
      connectedTo: ["pad-port", "remote-port", "ground"],
    }
    const cases: Array<{ point: ConnectionPoint; expected: boolean }> = [
      {
        point: { x: 0, y: 1.5, layer: "bottom", pcb_port_id: "pad-port" },
        expected: true,
      },
      {
        point: { x: 1.5, y: 0, layer: "bottom", pcb_port_id: "pad-port" },
        expected: false,
      },
      {
        point: { x: 8, y: 8, layer: "bottom", pcb_port_id: "remote-port" },
        expected: false,
      },
      {
        point: { x: 0, y: 1.5, layer: "top", pcb_port_id: "pad-port" },
        expected: false,
      },
      {
        point: { x: 0.5005, y: 1.5, layer: "bottom" },
        expected: true,
      },
      {
        point: { x: 0.502, y: 1.5, layer: "bottom" },
        expected: false,
      },
      {
        point: { x: 0.5006, y: 2.0006, layer: "bottom" },
        expected: true,
      },
      {
        point: { x: 0.5008, y: 2.0008, layer: "bottom" },
        expected: false,
      },
    ]
    for (const { point, expected } of cases) {
      expect(
        isConnectionPointOnObstacle({ point, obstacle, layerCount: 8 }),
      ).toBe(expected)
    }

    const diagonalObstacle: Obstacle = {
      ...obstacle,
      center: { x: 10, y: -5 },
      ccwRotationDegrees: 45,
    }
    for (const [x, y, expected] of [
      [11.3, -3.7, true],
      [11.5, -5, false],
    ] as const) {
      expect(
        isConnectionPointOnObstacle({
          point: { x, y, layer: "bottom", pcb_port_id: "pad-port" },
          obstacle: diagonalObstacle,
          layerCount: 8,
        }),
      ).toBe(expected)
    }
  },
)
