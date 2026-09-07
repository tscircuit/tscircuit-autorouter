import { expect, test } from "bun:test"
import type { Obstacle } from "lib/types"
import {
  mergeRectangularSmtPadObstacles,
} from "lib/testing/utils/mergeRectangularSmtPadObstacles"

test("retains every piece of unsupported pad unions", (): void => {
  const pad = (): Obstacle => ({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: ["same-net"],
    circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "port" },
  })
  const changed = (update: Partial<Obstacle>): Obstacle => ({
    ...pad(),
    center: { x: 0, y: 0.5 },
    ...update,
  })
  const cases: Obstacle[][] = [
    [pad()],
    [pad(), changed({ center: { x: 0, y: 1.01 } })],
    [pad(), changed({ center: { x: 0.5, y: 0.5 } })],
    [pad(), changed({ width: 0.75 })],
    [pad(), changed({ ccwRotationDegrees: 45 })],
    [pad(), changed({ layers: ["bottom"] })],
    [pad(), changed({ layers: ["top", "bottom"] })],
    [pad(), changed({ width: Number.NaN })],
    [pad(), changed({ height: 0 })],
    [pad(), changed({ circuitJsonMetadata: { pcb_smtpad_id: "other" } })],
    [
      pad(),
      changed({
        circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "other" },
      }),
    ],
    [
      pad(),
      changed({
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad",
          pcb_port_id: "port",
          pcb_plated_hole_id: "hole",
        },
      }),
    ],
  ]
  for (const obstacles of cases) {
    const original = [...obstacles]
    const result = mergeRectangularSmtPadObstacles(obstacles)
    expect(result).toBe(obstacles)
    expect(result).toHaveLength(original.length)
    result.forEach((piece, index): void => {
      expect(piece).toBe(original[index])
    })
  }
})
