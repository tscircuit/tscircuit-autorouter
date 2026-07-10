import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"

test("merged connection identity does not depend on input order", () => {
  const connectionA = {
    name: "connection_a",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" as const },
      { x: 1, y: 0, layer: "top" as const },
    ],
  }
  const connectionB = {
    name: "connection_b",
    pointsToConnect: [
      { x: 1, y: 0, layer: "top" as const },
      { x: 2, y: 0, layer: "top" as const },
    ],
  }

  const forward = mergeConnections([connectionA, connectionB])
  const reversed = mergeConnections([connectionB, connectionA])

  expect(forward[0]?.name).toBe(reversed[0]?.name)
  expect(forward[0]?.__rootConnectionNames).toEqual(
    reversed[0]?.__rootConnectionNames,
  )
})
