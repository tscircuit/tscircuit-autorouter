import { describe, expect, test } from "bun:test"
import { createOctGrid, octPitchAtHexDensity } from "../src/octGrid"

const bounds = { minX: -3.7, minY: 2.3, maxX: 9.1, maxY: 7.2 }

describe("octagonal lattice geometry", () => {
  test("equal-density pitch preserves the area assigned to each vertex", () => {
    const hexPitch = 0.25
    const octPitch = octPitchAtHexDensity(hexPitch)
    expect(octPitch * octPitch).toBeCloseTo(
      (Math.sqrt(3) / 2) * hexPitch * hexPitch,
      12,
    )
  })
})
