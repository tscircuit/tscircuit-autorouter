import { expect, test } from "bun:test"
import { assertPhysicalPeerClearances } from "lib/utils/assertPhysicalPeerClearances"

test("physical peer rules require explicit finite nonnegative trace and via clearances", (): void => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    for (const field of [
      "traceToTraceClearance",
      "viaToTraceClearance",
    ] as const) {
      const input = {
        traceToTraceClearance: 0.1,
        viaToTraceClearance: 0.15,
        [field]: invalid,
      } as Parameters<typeof assertPhysicalPeerClearances>[0]
      expect((): void => {
        assertPhysicalPeerClearances(input)
      }).toThrow("Physical peer clearances must be finite and nonnegative")
    }
  }
  expect((): void => {
    assertPhysicalPeerClearances({
      traceToTraceClearance: 0,
      viaToTraceClearance: 0,
    })
    assertPhysicalPeerClearances({
      traceToTraceClearance: 0.1,
      viaToTraceClearance: 0.15,
    })
  }).not.toThrow()
})
