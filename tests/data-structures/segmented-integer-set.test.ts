import { expect, test } from "bun:test"
import { SegmentedIntegerSet } from "lib/data-structures/SegmentedIntegerSet"

test("SegmentedIntegerSet preserves set behavior within its declared range", () => {
  const integers = new SegmentedIntegerSet(5000)

  expect(integers.add(4999)).toBe(integers)
  integers.add(0)
  integers.add(4096)
  integers.add(4999)

  expect(integers.size).toBe(3)
  expect(integers.has(0)).toBe(true)
  expect(integers.has(1)).toBe(false)
  expect(integers.has(4096)).toBe(true)
  expect(integers.has(4999)).toBe(true)
  expect([...integers]).toEqual([4999, 0, 4096])
  expect(integers.has(-1)).toBe(false)
  expect(integers.has(1.5)).toBe(false)
  expect(() => integers.add(-1)).toThrow(RangeError)
  expect(() => integers.add(1.5)).toThrow(RangeError)
  expect(() => integers.add(5000)).toThrow(RangeError)
  expect(() => new SegmentedIntegerSet(1.5)).toThrow(RangeError)

  integers.clear()

  expect(integers.size).toBe(0)
  expect(integers.has(0)).toBe(false)
  expect(integers.has(4096)).toBe(false)
  expect(integers.has(4999)).toBe(false)
  expect([...integers]).toEqual([])
})
