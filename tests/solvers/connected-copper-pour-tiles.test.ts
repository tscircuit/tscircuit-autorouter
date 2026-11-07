import { expect, test } from "bun:test"
import { getConnectedCopperPourObstacles } from "../../lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourObstacles"
import type { Obstacle } from "../../lib/types"

test("pour tiles join through shared copper without bridging gaps, layers, or nets", (): void => {
  const tile = (
    x: number,
    y: number,
    overrides: Partial<Obstacle> = {},
  ): Obstacle => ({
    type: "rect",
    layers: ["inner1"],
    center: { x, y },
    width: 2,
    height: 2,
    connectedTo: ["GND"],
    isCopperPour: true,
    ...overrides,
  })
  const a = tile(0, 0)
  const edge = tile(2, 0)
  const overlap = tile(3, 0)
  const transitive = tile(5, 0)
  const corner = tile(-2, -2)
  const gap = tile(0, 2.000001)
  const otherLayer = tile(0, 0, { layers: ["inner2"] })
  const otherNet = tile(0, 0, { connectedTo: ["VCC"] })
  const circle = tile(2, 2, { shape: "circle" })
  const rotated = tile(2, 2, { ccwRotationDegrees: 45 })
  const tiles = [
    a,
    edge,
    overlap,
    transitive,
    corner,
    gap,
    otherLayer,
    otherNet,
    circle,
    rotated,
  ]
  const connected = getConnectedCopperPourObstacles(tiles)
  expect(connected.size).toBe(tiles.length)
  for (const joined of [edge, overlap, transitive]) {
    expect(connected.get(joined)).toBe(a)
  }
  for (const isolated of [corner, gap, otherLayer, otherNet, circle, rotated]) {
    expect(connected.get(isolated)).toBe(isolated)
  }
})
