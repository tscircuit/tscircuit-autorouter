import { expect, test } from "bun:test"
import { canRejectTinyDistanceByAxis, canRejectTinyDistanceByBase } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyConservativeAxisDistanceBound"

test("conservative distance bounds reject only native IEEE rejections at rounded and exceptional boundaries", (): void => {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  const adjacent = (value: number, direction: bigint): number => {
    if (Number.isNaN(value) || (value === Infinity && direction > 0n) ||
      (value === -Infinity && direction < 0n)) return value
    if (value === 0) return direction > 0n ? Number.MIN_VALUE : -Number.MIN_VALUE
    view.setFloat64(0, value)
    view.setBigUint64(0, view.getBigUint64(0) + (value > 0 ? direction : -direction))
    return view.getFloat64(0)
  }
  let provedBase = 0
  let provedAxis = 0
  let checked = 0
  const check = (dx: number, dy: number, base: number, best: number, scale: number): void => {
    const nativeCost = base + Math.sqrt(dx * dx + dy * dy) * scale
    const rejectBase = canRejectTinyDistanceByBase(dx, dy, base, best, scale)
    const rejectAxis = canRejectTinyDistanceByAxis(dx, dy, base, best, scale)
    if (rejectBase) { provedBase++; expect(nativeCost >= best).toBe(true) }
    if (rejectAxis) { provedAxis++; expect(nativeCost >= best).toBe(true) }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(base) ||
      !Number.isFinite(best) || !Number.isFinite(scale) || scale <= 0) {
      expect(rejectBase).toBe(false)
      expect(rejectAxis).toBe(false)
    }
    checked++
  }
  const threshold = 2 ** -511
  const axes = [0, -0, Number.MIN_VALUE, adjacent(threshold, -1n), threshold,
    adjacent(threshold, 1n), 0.1, 1, adjacent(1, -1n), adjacent(1, 1n),
    2 ** 511, Math.sqrt(Number.MAX_VALUE), Number.MAX_VALUE]
  for (const axis of axes) {
    for (const sign of [-1, 1]) {
      for (const dy of [0, axis, axis / 3, -axis]) {
        for (const base of [0, -0, Number.MIN_VALUE, -Number.MAX_VALUE, -10, 10]) {
          for (const scale of [Number.MIN_VALUE, 2 ** -500, 0.05, 1, 2, Number.MAX_VALUE]) {
            const dx = axis * sign
            const cost = base + Math.sqrt(dx * dx + dy * dy) * scale
            for (const best of [cost, adjacent(cost, -1n), adjacent(cost, 1n), 0, -Number.MAX_VALUE, Number.MAX_VALUE]) {
              check(dx, dy, base, best, scale)
            }
          }
        }
      }
    }
  }
  // Coordinate subtraction is rounded before the native square operation.
  for (const source of [Number.MAX_VALUE, -Number.MAX_VALUE, 1, -1, threshold]) {
    for (const destination of [-source, adjacent(source, -1n), adjacent(source, 1n)]) {
      check(source - destination, source - (-destination), -10, 0, 0.05)
    }
  }
  for (const exceptional of [Number.NaN, Infinity, -Infinity, -1, 0, -0]) {
    check(exceptional, 1, 0, 1, 1)
    check(1, exceptional, 0, 1, 1)
    check(1, 1, exceptional, 1, 1)
    check(1, 1, 0, exceptional, 1)
    check(1, 1, 0, 1, exceptional)
  }
  let state = 0x71b26c9d
  const random = (): number => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state }
  const number = (): number => {
    view.setUint32(0, random())
    view.setUint32(4, random())
    return view.getFloat64(0)
  }
  for (let index = 0; index < 100_000; index++) {
    const dx = number(), dy = number(), base = number(), scale = Math.abs(number())
    const cost = base + Math.sqrt(dx * dx + dy * dy) * scale
    check(dx, dy, base, adjacent(cost, index % 2 ? 1n : -1n), scale)
  }
  expect(checked).toBeGreaterThan(120_000)
  expect(provedBase).toBeGreaterThan(1_000)
  expect(provedAxis).toBeGreaterThan(provedBase)
})
