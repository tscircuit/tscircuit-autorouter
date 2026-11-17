import { expect, test } from "bun:test"
import input from "../../fixtures/bug-reports/beagleplay-am6254-ddr4/input.srj.json"
import type { SimpleRouteJson } from "lib/types"

test("BeaglePlay DDR4 retains native pads and signal nets", () => {
  const srj = input as SimpleRouteJson
  expect(srj.layerCount).toBe(8)
  expect(srj.bounds).toEqual({
    minX: 0,
    minY: 0,
    maxX: 80.00238,
    maxY: 80.00238,
  })
  expect(srj.obstacles).toHaveLength(2994)
  expect(srj.traces).toBeUndefined()

  const am6254Pads = srj.obstacles.filter((pad) => pad.componentId === "U1")
  const ddr4Pads = srj.obstacles.filter((pad) => pad.componentId === "U2")
  expect(am6254Pads).toHaveLength(425)
  expect(ddr4Pads).toHaveLength(96)
  for (const pad of [...am6254Pads, ...ddr4Pads]) {
    expect(pad.layers).toEqual(["bottom"])
  }

  const nets = new Map(srj.connections.map((net) => [net.name, net]))
  expect(nets.size).toBe(52)
  expect([...nets.keys()].every((name) => name.startsWith("DDR_"))).toBe(true)
  expect(nets.has("DDR_VPP")).toBe(false)
  expect(nets.has("DDR_VREFCA")).toBe(false)
  for (let bit = 0; bit < 16; bit++) {
    expect(nets.get(`DDR_DQ${bit}`)?.pointsToConnect).toHaveLength(2)
  }
  expect(
    nets.get("DDR_CLKP")?.pointsToConnect.map((point) => point.pointId),
  ).toEqual(["R2.1", "U1.L1", "U2.K7"])
  expect(
    nets.get("DDR_TEN")?.pointsToConnect.map((point) => point.pointId),
  ).toEqual(["R81.2", "R83.1", "U2.N9"])

  const terminals = srj.connections.flatMap((net) => net.pointsToConnect)
  expect(terminals).toHaveLength(111)
  expect(new Set(terminals.map((point) => point.pointId)).size).toBe(111)
  for (const { name, pointsToConnect } of srj.connections) {
    for (const point of pointsToConnect) {
      const layers = point.layers ?? [point.layer]
      expect(
        srj.obstacles.some(
          (pad) =>
            pad.connectedTo.includes(name) &&
            pad.center.x === point.x &&
            pad.center.y === point.y &&
            layers.every((layer) => pad.layers.includes(layer)),
        ),
      ).toBe(true)
    }
  }
})
