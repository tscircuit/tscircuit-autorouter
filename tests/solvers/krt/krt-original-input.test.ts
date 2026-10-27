import { expect, test } from "bun:test"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT normalization retains close terminals and does not mutate original obstacles", (): void => {
  const original = krtTestBoard()
  original.connections[0].pointsToConnect[1].x = 0.01
  original.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["tree"],
  })
  const before = structuredClone(original)
  const prepared = prepareKrtBranches(original)
  expect(original).toEqual(before)
  expect(prepared.branches).toHaveLength(2)
  expect(
    prepared.branches.some((branch) =>
      branch.points.some((point) => point.x === 0.01),
    ),
  ).toBe(true)
  expect(prepared.srj.obstacles[0].connectedTo.length).toBeGreaterThan(1)
  const aliases = prepared.srj.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => point.pointId),
  )
  expect(new Set(aliases).size).toBe(aliases.length)
})
