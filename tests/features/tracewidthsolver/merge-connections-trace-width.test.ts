import { test, expect } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import { SimpleRouteConnection } from "lib/types"

test("mergeConnections preserves traceWidthMultiplier", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "VCC_A",
      traceWidthMultiplier: 4,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 1, layer: "top" },
      ],
    },
    {
      name: "VCC_B",
      traceWidthMultiplier: 2,
      pointsToConnect: [
        { x: 1, y: 1, layer: "top" }, // Shared point triggers merge
        { x: 2, y: 2, layer: "top" },
      ],
    },
  ]

  const merged = mergeConnections(connections)

  expect(merged.length).toBe(1)
  // Should pick the largest multiplier (4)
  expect(merged[0].traceWidthMultiplier).toBe(4)
})

test("mergeConnections preserves nominalTraceWidth from first connection", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "POWER_A",
      nominalTraceWidth: 0.6,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 1, layer: "top" },
      ],
    },
    {
      name: "POWER_B",
      nominalTraceWidth: 0.3,
      pointsToConnect: [
        { x: 1, y: 1, layer: "top" },
        { x: 2, y: 2, layer: "top" },
      ],
    },
  ]

  const merged = mergeConnections(connections)

  expect(merged.length).toBe(1)
  expect(merged[0].nominalTraceWidth).toBe(0.6)
})
