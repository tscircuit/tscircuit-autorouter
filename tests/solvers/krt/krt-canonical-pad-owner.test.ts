import { expect, test } from "bun:test"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT presents one canonical copper owner for every same-net pad and branch", (): void => {
  const original = krtTestBoard()
  original.obstacles.push({
    type: "rect",
    center: { x: 1, y: 0.5 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["c"],
  })
  const prepared = prepareKrtBranches(original)
  const owners = prepared.srj.connections.map((connection) => connection.sourceTraceId)
  expect(new Set(owners).size).toBe(1)
  expect(prepared.srj.obstacles[0].connectedTo).toContain(owners[0])
  expect(original.obstacles[0].connectedTo).toEqual(["c"])
})
