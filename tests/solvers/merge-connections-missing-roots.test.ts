import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"

test("merged connections use their names when root connections are missing", () => {
  const connections = mergeConnections([
    {
      name: "connection_a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "connection_b",
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.__rootConnectionNames).toEqual([
    "connection_a",
    "connection_b",
  ])
})
