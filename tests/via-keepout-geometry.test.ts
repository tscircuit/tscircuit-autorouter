import { expect, test } from "bun:test"
import { isViaInKeepout } from "../lib/utils/isViaInKeepout"
import type { ViaKeepout } from "../lib/types/srj-types"

test("via keepouts check copper extent, circle corners and physical layers", () => {
  const rect: ViaKeepout = { shape: "rect", center: { x: 0, y: 0 }, width: 8, height: 6, layers: ["inner1"] }
  expect(isViaInKeepout({ x: 4.5, y: 0 }, 2, [rect], 4)).toBe(true)
  expect(isViaInKeepout({ x: 5, y: 0 }, 2, [rect], 4)).toBe(false)
  expect(isViaInKeepout({ x: 4.8, y: 3.8 }, 2, [rect], 4)).toBe(false)
  expect(isViaInKeepout({ x: 4.5, y: 3.5 }, 2, [rect], 4)).toBe(true)
  expect(isViaInKeepout({ x: 0, y: 0 }, 2, [rect], 4, 2, 3)).toBe(false)
  expect(isViaInKeepout({ x: 0, y: 0 }, 2, [rect], 4, 0, 1)).toBe(true)
  const outline: ViaKeepout = { shape: "outline", outline: [{ x: 0, y: 0 }, { x: 2, y: 2 }], strokeWidth: 0.2, layers: ["top"] }
  expect(isViaInKeepout({ x: 1, y: 1 }, 0.4, [outline], 2)).toBe(true)
  expect(isViaInKeepout({ x: 1, y: 0 }, 0.4, [outline], 2)).toBe(false)
  const circle: ViaKeepout = { shape: "circle", center: { x: 10, y: -5 }, radius: 2, layers: ["bottom"] }
  expect(isViaInKeepout({ x: 12.9, y: -5 }, 2, [circle], 2)).toBe(true)
  expect(isViaInKeepout({ x: 13, y: -5 }, 2, [circle], 2)).toBe(false)
  expect(isViaInKeepout({ x: 0, y: 0 }, 2, [], 2)).toBe(false)
})
