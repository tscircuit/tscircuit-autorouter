import { expect, test } from "bun:test"
import objectHash from "object-hash"
import {
  serializeSolverCacheKeyData,
  type SolverCacheKeyValue,
} from "lib/cache/serializeSolverCacheKeyData"

test("solver cache serialization retains object-hash keys for typed and shared values", (): void => {
  const shared = { name: "net:α,🧭", absent: undefined, count: NaN }
  const sparse: SolverCacheKeyValue[] = []
  sparse.length = 3
  sparse[2] = Infinity
  const cyclic: Record<string, SolverCacheKeyValue> = { first: shared }
  cyclic.self = cyclic
  const values: SolverCacheKeyValue[] = [
    null,
    undefined,
    true,
    false,
    -0,
    NaN,
    Infinity,
    -Infinity,
    "string:1:a,number:2",
    "\ud800",
    [],
    {},
    sparse,
    cyclic,
    { shared, again: shared, absent: undefined },
    { node: { availableZ: [0, 1], points: [{ x: 1.1, y: 2.2, z: 0 }] } },
  ]
  for (const value of values) {
    expect(serializeSolverCacheKeyData({ value })).toBe(
      objectHash({ value }, {
        algorithm: "passthrough",
        respectType: false,
        unorderedObjects: false,
      }),
    )
  }
})
