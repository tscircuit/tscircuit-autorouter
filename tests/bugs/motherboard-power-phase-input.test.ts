import { expect, test } from "bun:test"
import { loadMotherboardPowerPhase } from "../../scripts/repro-motherboard-power-phase"

test("loads the exact power phase repro without dropping preloaded copper or constraints", () => {
  const input = loadMotherboardPowerPhase()
  const output = loadMotherboardPowerPhase("captured-output")
  expect(input.connections).toHaveLength(21)
  expect(input.obstacles).toHaveLength(1280)
  expect(input.traces).toHaveLength(638)
  expect(output.traces).toHaveLength(761)
  expect(input.layerCount).toBe(4)
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.allowViaInPad).toBe(false)
  expect(input.obstacles.filter((o) => o.isCopperPour)).toHaveLength(2)
  expect(new Set(input.traces?.map((t) => t.pcb_trace_id)).size).toBe(638)
  expect(input.connections.every((c) => c.pointsToConnect.length >= 2)).toBe(true)
})
