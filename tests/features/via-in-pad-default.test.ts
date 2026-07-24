import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib"
import { isViaInPadEnabled } from "lib/utils/isViaInPadEnabled"

const baseSrj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  connections: [],
  bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
}

test("requires SimpleRouteJson to explicitly enable via-in-pad repair", () => {
  expect(isViaInPadEnabled(baseSrj)).toBe(false)
  expect(isViaInPadEnabled({ ...baseSrj, allowViaInPad: false })).toBe(false)
  expect(isViaInPadEnabled({ ...baseSrj, allowViaInPad: true })).toBe(true)
})
