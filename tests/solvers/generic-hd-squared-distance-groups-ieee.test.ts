import { expect, test } from "bun:test"
import { ClosestSquaredDistanceGroups } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/generic-hd-closest-point/ClosestSquaredDistanceGroups"

test("one-miss group bounds preserve intrinsic sqrt minima across IEEE inputs", (): void => {
  const sqrt = Math.sqrt
  const finite = [0, -0, Number.MIN_VALUE, 1e-300, 1e-150, 1e-20, 0.1, 1, 2,
    1e20, 1e150, 1e300, Number.MAX_VALUE, Infinity]
  const penalties = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 0.1, -0.1, 1e150,
    -1e150, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN]
  let checked = 0, skipped = 0, seed = 0x71592
  for (let sequence = 0; sequence < 8192; sequence++) {
    const groups = new ClosestSquaredDistanceGroups()
    let nativeMinimum = Infinity, optimizedMinimum = Infinity
    let nativeIndex = -1, optimizedIndex = -1
    for (let index = 0; index < 64; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const dx = finite[seed % finite.length]!
      const dy = finite[(seed >>> 9) % finite.length]!
      const square = dx * dx + dy * dy
      const isVia = !!(seed & 0x10000)
      const penalty = isVia ? penalties[(seed >>> 17) % penalties.length]! : 0
      const total = sqrt(square) + penalty
      const skip = groups.canSkip(square, penalty, isVia)
      if (skip) {
        expect(total < nativeMinimum).toBe(false)
        skipped++
      } else {
        if (total < optimizedMinimum) { optimizedMinimum = total; optimizedIndex = index }
        groups.recordCompleted(square, penalty, isVia, total)
      }
      if (total < nativeMinimum) { nativeMinimum = total; nativeIndex = index }
      expect(Object.is(optimizedMinimum, nativeMinimum)).toBe(true)
      expect(optimizedIndex).toBe(nativeIndex)
      checked++
    }
  }
  const disabled = new ClosestSquaredDistanceGroups()
  disabled.recordCompleted(1, 0, false, 1)
  disabled.disableAfterNonIntrinsicCall()
  expect(disabled.canSkip(2, 0, false)).toBe(false)
  const unsupported = new ClosestSquaredDistanceGroups()
  unsupported.recordCompleted(1, 0, false, "2" as unknown as number)
  expect(unsupported.canSkip(2, 0, false)).toBe(false)
  expect(checked).toBe(524288)
  expect(skipped).toBeGreaterThan(0)
})
