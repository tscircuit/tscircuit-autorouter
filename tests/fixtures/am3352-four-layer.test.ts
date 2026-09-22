import { expect, test } from "bun:test"
import srj from "../../fixtures/bug-reports/bugreport108-am3352-four-layer/am3352-four-layer.srj.json"

test("AM3352 fixture contains the complete unphased board without saved routing", () => {
  expect(srj.layerCount).toBe(4)
  expect(srj.bounds).toEqual({ minX: -35, maxX: 35, minY: -30, maxY: 30 })
  expect(srj.connections).toHaveLength(138)
  const points = srj.connections.flatMap((c) => c.pointsToConnect)
  expect(points).toHaveLength(774)
  expect(new Set(points.map((p) => p.pcb_port_id)).size).toBe(774)
  expect(srj.obstacles).toHaveLength(907)
  expect(srj.traces).toEqual([])
  expect(srj.allowViaInPad).toBe(false)
  expect(srj.allowBlindAndBuriedVias).toBe(false)
  expect(srj.minViaHoleDiameter).toBe(0.15)
  expect(srj.minViaPadDiameter).toBe(0.3)
  const serialized = JSON.stringify(srj)
  expect(serialized).not.toMatch(/routing_phase|routingPhase|externallyConnectedPointIds|pcb_via_id|isCopperPour/)
  expect(points.some((p) => p.port_selector?.startsWith("U1."))).toBe(true)
  expect(points.some((p) => p.port_selector?.startsWith("U3."))).toBe(true)
  expect(srj.buses.map((b) => b.connectionNames.length)).toEqual([11, 11, 2, 2, 2, 2])
  const names = new Set(srj.connections.map((c) => c.name))
  for (const bus of srj.buses) {
    for (const name of bus.connectionNames) expect(names.has(name)).toBe(true)
  }
})
