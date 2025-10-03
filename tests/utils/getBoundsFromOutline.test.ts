import { describe, expect, test } from "bun:test"
import { getBoundsFromOutline } from "../../lib"

describe("getBoundsFromOutline", () => {
  test("computes bounds for a simple triangle (not closed)", () => {
    const outline = [
      { x: 1, y: 1 },
      { x: 5, y: 2 },
      { x: 3, y: 6 },
    ]
    const b = getBoundsFromOutline(outline)
    expect(b).toEqual({ minX: 1, minY: 1, maxX: 5, maxY: 6 })
  })

  test("computes bounds with negative coordinates", () => {
    const outline = [
      { x: -10, y: -5 },
      { x: -2, y: -8 },
      { x: -6, y: -1 },
    ]
    const b = getBoundsFromOutline(outline)
    expect(b).toEqual({ minX: -10, minY: -8, maxX: -2, maxY: -1 })
  })

  test("throws on empty outline", () => {
    expect(() => getBoundsFromOutline([])).toThrow(
      "Outline must contain at least one point",
    )
  })
})
