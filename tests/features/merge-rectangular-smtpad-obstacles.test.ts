import { expect, test } from "bun:test"
import type { Obstacle } from "lib/types"
import {
  mergeRectangularSmtPadObstacles,
} from "lib/testing/utils/mergeRectangularSmtPadObstacles"

test("merges aligned pad strips without mutating input", (): void => {
  const pad = (
    id: string,
    x: number,
    y: number,
    alias: string,
  ): Obstacle => ({
    type: "rect",
    center: { x, y },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: ["shared-net", alias],
    circuitJsonMetadata: { pcb_smtpad_id: id, pcb_port_id: `${id}-port` },
  })
  const untouched = pad("unrelated", 8, 8, "other")
  const obstacles = [
    pad("vertical", 0, 0.5, "upper"),
    untouched,
    pad("horizontal", 3, 0, "left"),
    pad("vertical", 0, 0, "lower"),
    pad("horizontal", 3.5, 0, "right"),
  ]
  const original = structuredClone(obstacles)
  const merged = mergeRectangularSmtPadObstacles(obstacles)
  expect(merged).toHaveLength(3)
  expect(merged[0]).toMatchObject({
    center: { x: 0, y: 0.25 },
    width: 1,
    height: 1.5,
    connectedTo: ["shared-net", "upper", "lower"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "vertical",
      pcb_port_id: "vertical-port",
    },
  })
  expect(merged[1]).toBe(untouched)
  expect(merged[2]).toMatchObject({
    center: { x: 3.25, y: 0 },
    width: 1.5,
    height: 1,
    connectedTo: ["shared-net", "left", "right"],
  })
  expect(obstacles).toEqual(original)
})
