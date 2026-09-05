import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getPreferredClearanceSrj } from "lib/utils/getPreferredClearanceSrj"

test("cleanup seeks relaxed trace spacing without mutating manufacturing rules or changing defaults", () => {
  for (const traceClearance of [undefined, 0.05, 0.1, 0.2]) {
    const input: SimpleRouteJson = {
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: traceClearance,
      minViaEdgeToPadEdgeClearance: 0.05,
      obstacles: [],
      connections: [],
    }
    const result = getPreferredClearanceSrj(input)
    expect(result.minTraceToPadEdgeClearance).toBe(
      traceClearance === undefined ? undefined : Math.max(0.1, traceClearance),
    )
    expect(result.minViaEdgeToPadEdgeClearance).toBe(0.05)
    expect(input.minTraceToPadEdgeClearance).toBe(traceClearance)
    expect(result.obstacles).toBe(input.obstacles)
  }
})
