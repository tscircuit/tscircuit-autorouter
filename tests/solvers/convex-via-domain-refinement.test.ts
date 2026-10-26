import { expect, test } from "bun:test"
import {
  refineViaDomainByConvexCover,
  type ConvexViaExclusion,
  type ViaDomainRectangle,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/refineViaDomainByConvexCover"

test("convex cover retains every legal center when covers, work or precision are incomplete", (): void => {
  const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const union = [
    { minX: -0.4, maxX: 0.2, minY: 0, maxY: 0.8, radius: 0.4 },
    { minX: 0.8, maxX: 1.4, minY: 0, maxY: 0.8, radius: 0.4 },
  ]
  const input = { bounds, exclusions: union, slack: 1e-9 }
  const snapshot = structuredClone(input)
  const empty = refineViaDomainByConvexCover(input)
  expect(empty.minX).toBeGreaterThan(empty.maxX)
  const one = refineViaDomainByConvexCover({
    ...input,
    exclusions: [union[0]!],
  })
  expect(one.minX <= one.maxX && one.minY <= one.maxY).toBe(true)
  const separate = [
    { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 1.1, radius: 0.1 },
    { minX: 0.9, maxX: 1.1, minY: -0.1, maxY: 1.1, radius: 0.1 },
  ]
  const middle = refineViaDomainByConvexCover({
    ...input,
    exclusions: separate,
  })
  expect(middle.minX).toBeLessThanOrEqual(0.5)
  expect(middle.maxX).toBeGreaterThanOrEqual(0.5)
  const tangent = { minX: 0.5, maxX: 1.5, minY: 0, maxY: 1 }
  expect(
    refineViaDomainByConvexCover({
      bounds: tangent,
      exclusions: [{ minX: -1, maxX: 0, minY: -1, maxY: 2, radius: 0.5 }],
      slack: 1e-9,
    }),
  ).toEqual(tangent)
  expect(refineViaDomainByConvexCover({ ...input, exclusions: [] })).toEqual(
    bounds,
  )
  expect(
    refineViaDomainByConvexCover({
      ...input,
      exclusions: [{ ...union[0]!, radius: Number.NaN }],
    }),
  ).toEqual(bounds)
  const precise = { minX: 2 ** 52, maxX: 2 ** 52 + 1, minY: 0, maxY: 1 }
  expect(
    refineViaDomainByConvexCover({
      bounds: precise,
      exclusions: [{ ...precise, maxX: precise.minX, radius: 0.1 }],
      slack: 0,
    }),
  ).toEqual(precise)
  const degenerate = { ...bounds, maxX: bounds.minX }
  expect(
    refineViaDomainByConvexCover({ ...input, bounds: degenerate }),
  ).toEqual(degenerate)

  let randomState = 981723
  const nextRandom = (): number => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    const value = randomState / 2 ** 32
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid deterministic geometry sample")
    return value
  }
  const cases: ConvexViaExclusion[][] = [union, separate]
  for (let index = 0; index < 30; index++) {
    cases.push(
      Array.from({ length: 2 + (index % 4) }, (): ConvexViaExclusion => {
        const x = nextRandom() * 1.5 - 0.25,
          y = nextRandom() * 1.5 - 0.25
        const width = nextRandom() * 0.5,
          height = nextRandom() * 0.5
        return {
          minX: x,
          maxX: x + width,
          minY: y,
          maxY: y + height,
          radius: nextRandom() * 0.4 + 0.01,
        }
      }),
    )
  }
  let legal = 0
  for (const exclusions of cases) {
    const refined: ViaDomainRectangle = refineViaDomainByConvexCover({
      ...input,
      exclusions,
    })
    for (let ix = 0; ix <= 32; ix++)
      for (let iy = 0; iy <= 32; iy++) {
        const x = ix / 32,
          y = iy / 32
        if (
          exclusions.some(
            (pad) =>
              Math.hypot(
                Math.max(pad.minX - x, x - pad.maxX, 0),
                Math.max(pad.minY - y, y - pad.maxY, 0),
              ) < pad.radius,
          )
        )
          continue
        legal++
        expect(
          x >= refined.minX &&
            x <= refined.maxX &&
            y >= refined.minY &&
            y <= refined.maxY,
        ).toBe(true)
      }
  }
  expect(legal).toBeGreaterThan(10000)
  expect(input).toEqual(snapshot)
})
