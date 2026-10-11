import { expect, test } from "bun:test"
import { mayCopperViolateObstacleClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair02/mayCopperViolateObstacleClearance"
import { getRouteObstacleClearance } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"
import type { Obstacle, XY } from "high-density-repair02/lib/high-density-repair-solver/shared/types"

function assertNativeContact(
  start: XY, end: XY, radius: number, obstacle: Obstacle, clearance: number,
): boolean {
  const mayContact = mayCopperViolateObstacleClearance({ start, end, radius }, obstacle, clearance)
  const nativeClearance = getRouteObstacleClearance({
    connectionName: "test", route: [{ ...start, z: 0 }, { ...end, z: 0 }],
    traceThickness: radius * 2, vias: [],
  }, obstacle)
  if (!mayContact) expect(clearance - nativeClearance).toBeLessThanOrEqual(1e-6)
  return mayContact
}

test("repair02 obstacle broadphase conservatively retains native EPS contacts, finite-width strokes and unsupported arithmetic", (): void => {
  const obstacle: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 2, height: 2 }
  for (const radius of [0, 0.001, 0.05, 0.15]) {
    for (const clearance of [0, 1e-6, 0.1]) {
      for (const offset of [-2e-6, -1e-6, 0, 1e-6, 2e-6, 0.01]) {
        const x = 1 + radius + clearance + offset
        assertNativeContact({ x, y: -2 }, { x, y: 2 }, radius, obstacle, clearance)
        assertNativeContact({ x: -2, y: x }, { x: 2, y: x }, radius, obstacle, clearance)
        assertNativeContact({ x, y: x }, { x, y: x }, radius, obstacle, clearance)
      }
    }
  }
  expect(assertNativeContact({ x: 10, y: -2 }, { x: 10, y: 2 }, 0.05, obstacle, 0.1)).toBe(false)
  expect(assertNativeContact({ x: -2, y: 0 }, { x: 2, y: 0 }, 0.05, obstacle, 0.1)).toBe(true)
  expect(assertNativeContact({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.05, obstacle, 0)).toBe(true)
  const underflowObstacle: Obstacle = { type: "rect", center: { x: -0.1, y: 0.5 }, width: 0.2, height: 1 }
  const underflowStart = { x: 0, y: 1.150003 }
  const underflowEnd = { x: Number.MIN_VALUE, y: 1.150003 }
  expect(getRouteObstacleClearance({ connectionName: "underflow", traceThickness: 0.1,
    route: [{ ...underflowStart, z: 0 }, { ...underflowEnd, z: 0 }], vias: [] }, underflowObstacle)).toBe(-0.05)
  expect(assertNativeContact(underflowStart, underflowEnd, 0.05, underflowObstacle, 0.1)).toBe(true)
  for (const tiny of [Number.MIN_VALUE, -Number.MIN_VALUE, 1e-300, 1e-150, 1e-76]) {
    expect(mayCopperViolateObstacleClearance({ start: { x: tiny, y: 10 }, end: { x: 0, y: 10 }, radius: 0.05 }, obstacle, 0.1)).toBe(true)
    expect(mayCopperViolateObstacleClearance({ start: { x: 10, y: 0 }, end: { x: 10, y: 1 }, radius: 0.05 }, { ...obstacle, width: Math.abs(tiny) }, 0.1)).toBe(true)
  }

  let seed = 0x591bac71
  const random = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x100000000
  }
  let rejected = 0
  for (let caseIndex = 0; caseIndex < 5000; caseIndex++) {
    const magnitude = caseIndex % 11 === 0 ? 1_000_000 : caseIndex % 5 === 0 ? 0.001 : 100
    const start = { x: (random() * 2 - 1) * magnitude, y: (random() * 2 - 1) * magnitude }
    const end = caseIndex % 7 === 0 ? { ...start }
      : { x: (random() * 2 - 1) * magnitude, y: (random() * 2 - 1) * magnitude }
    const pad: Obstacle = {
      type: caseIndex % 2 === 0 ? "rect" : "oval",
      center: { x: (random() * 2 - 1) * magnitude, y: (random() * 2 - 1) * magnitude },
      width: random() * magnitude / 3,
      height: caseIndex % 13 === 0 ? 0 : random() * magnitude / 3,
    }
    if (!assertNativeContact(start, end, random() / 3, pad, random() / 3)) rejected++
  }
  expect(rejected).toBeGreaterThan(2500)
  for (const value of [Number.NaN, Infinity, -Infinity, 1e12]) {
    expect(mayCopperViolateObstacleClearance({ start: { x: value, y: 0 }, end: { x: 0, y: 0 }, radius: 0.05 }, obstacle, 0.1)).toBe(true)
    expect(mayCopperViolateObstacleClearance({ start: { x: 10, y: 0 }, end: { x: 10, y: 1 }, radius: value }, obstacle, 0.1)).toBe(true)
    expect(mayCopperViolateObstacleClearance({ start: { x: 10, y: 0 }, end: { x: 10, y: 1 }, radius: 0.05 }, { ...obstacle, width: value }, 0.1)).toBe(true)
    expect(mayCopperViolateObstacleClearance({ start: { x: 10, y: 0 }, end: { x: 10, y: 1 }, radius: 0.05 }, obstacle, value)).toBe(true)
  }
  for (const invalid of [{ ...obstacle, center: undefined }, { ...obstacle, width: undefined }, { ...obstacle, width: -1 }]) {
    expect(mayCopperViolateObstacleClearance({ start: { x: 10, y: 0 }, end: { x: 10, y: 1 }, radius: 0.05 }, invalid, 0.1)).toBe(true)
  }
})
