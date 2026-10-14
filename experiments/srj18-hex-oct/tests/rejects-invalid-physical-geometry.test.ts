import { describe, expect, test } from "bun:test"
import { createOctGrid, octPitchAtHexDensity } from "../src/octGrid"

const bounds = { minX: -3.7, minY: 2.3, maxX: 9.1, maxY: 7.2 }

describe("octagonal lattice geometry", () => {

  test("rejects invalid physical geometry", () => {
    for (const pitch of [0, -1, Infinity, NaN]) {
      expect(() => createOctGrid(bounds, pitch)).toThrow()
      expect(() => octPitchAtHexDensity(pitch)).toThrow()
    }
    expect(() => createOctGrid({ ...bounds, minX: Infinity }, 0.2)).toThrow()
    expect(() => createOctGrid({ ...bounds, minY: 10 }, 0.2)).toThrow()
  })
})
