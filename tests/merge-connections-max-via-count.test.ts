import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"

test("merged connections keep the strictest via limit", () => {
  const [mergedConnection] = mergeConnections([
    {
      name: "XTAL_OUT",
      maxViaCount: 2,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "XTAL_LOAD_OUT",
      maxViaCount: 0,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(mergedConnection?.maxViaCount).toBe(0)
})
