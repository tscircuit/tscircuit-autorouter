import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import type { SimpleRouteConnection } from "lib/types"

test("merging connected traces preserves the greatest requested widths in either order", (): void => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "signal",
      nominalTraceWidth: 0.1,
      minTraceWidth: 0.1,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "motor",
      nominalTraceWidth: 1,
      minTraceWidth: 1,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ]

  for (const order of [connections, [...connections].reverse()]) {
    const [merged] = mergeConnections(order)
    expect(merged?.nominalTraceWidth).toBe(1)
    expect(merged?.minTraceWidth).toBe(1)
  }
})
