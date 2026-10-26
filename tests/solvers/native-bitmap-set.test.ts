import { expect, test } from "bun:test"
import { NativeExploredNodeSet } from "lib/data-structures/NativeExploredNodeSet"

test("Native membership mirrors preserve ordinary numeric Set mutations and order", (): void => {
  const mirrored = new NativeExploredNodeSet(4096)
  const reference = new Set<number>()
  const special = [
    NaN,
    Infinity,
    -Infinity,
    -1,
    -0,
    0,
    0.5,
    31,
    32,
    1023,
    1024,
    4095,
    4096,
    2 ** 32,
  ]
  let seed = 0x59a463
  for (let index = 0; index < 6000; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const key = index % 5 === 0 ? special[index % special.length]! : seed % 4200
    if (index % 127 === 0) {
      mirrored.clear()
      reference.clear()
    } else if (index % 4 === 0) {
      expect(mirrored.delete(key)).toBe(reference.delete(key))
    } else {
      expect(mirrored.add(key)).toBe(mirrored)
      reference.add(key)
    }
    for (const query of [key, key - 1, key + 1, ...special]) {
      expect(mirrored.has(query)).toBe(reference.has(query))
    }
    expect(mirrored.size).toBe(reference.size)
    expect([...mirrored]).toEqual([...reference])
  }
})
