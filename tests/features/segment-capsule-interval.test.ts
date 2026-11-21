import { expect, test } from "bun:test"
import { getSegmentCapsuleInterval } from "lib/utils/getSegmentCapsuleInterval"

test("crossing intervals follow round wires and vias without rectangle tiles", (): void => {
  const crossing = { start: { x: -2, y: 0 }, end: { x: 2, y: 0 } }
  const diagonal = getSegmentCapsuleInterval({
    ...crossing,
    capsuleStart: { x: -1, y: -1 },
    capsuleEnd: { x: 1, y: 1 },
    radius: Math.SQRT1_2,
  })
  expect(diagonal?.[0]).toBeCloseTo(0.25, 10)
  expect(diagonal?.[1]).toBeCloseTo(0.75, 10)
  expect(
    getSegmentCapsuleInterval({
      ...crossing,
      capsuleStart: { x: 0, y: 0 },
      capsuleEnd: { x: 0, y: 0 },
      radius: 0.5,
    }),
  ).toEqual([0.375, 0.625])
  expect(
    getSegmentCapsuleInterval({
      ...crossing,
      capsuleStart: { x: -1, y: 0.5 },
      capsuleEnd: { x: 1, y: 0.5 },
      radius: 0.5,
    }),
  ).toBeUndefined()
  expect(
    getSegmentCapsuleInterval({
      ...crossing,
      capsuleStart: { x: 0, y: -3 },
      capsuleEnd: { x: 0, y: 3 },
      radius: 5,
    }),
  ).toEqual([0, 1])
})
