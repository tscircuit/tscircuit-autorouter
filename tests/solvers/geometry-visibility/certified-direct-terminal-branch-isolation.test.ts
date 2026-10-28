import { expect, test } from "bun:test"
import { getKrtBranches } from "lib/testing/getKrtBranches"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("original terminal branches preserve identities without reading backend obstacle geometry", () => {
  const input = getCertifiedDirectTestInput()
  input.connections[0].pointsToConnect.push({
    x: 1, y: 1, layer: "top", pcb_port_id: "c", pointId: "original-c",
  })
  input.connections.push({
    name: "distinct-owner", nominalTraceWidth: 0.4,
    pointsToConnect: [
      { x: -1, y: 0, layer: "bottom", pcb_port_id: "other-a" },
      { x: 1, y: 0, layer: "bottom", pcb_port_id: "other-b" },
    ],
  })
  const originalConnections = JSON.stringify(input.connections)
  Object.defineProperty(input, "obstacles", {
    get: (): never => { throw new Error("backend geometry must not be read") },
  })
  const branches = getKrtBranches(input)
  expect(branches.map((branch) => branch.name)).toEqual([
    "krt_branch_0", "krt_branch_1", "krt_branch_2",
  ])
  expect(branches.map((branch) => branch.connection)).toEqual([
    input.connections[0], input.connections[0], input.connections[1],
  ])
  for (const connection of input.connections) {
    const ownBranches = branches.filter((branch) => branch.connection === connection)
    expect(ownBranches.length).toBe(connection.pointsToConnect.length - 1)
    expect(new Set(ownBranches.flatMap((branch) => branch.points))).toEqual(
      new Set(connection.pointsToConnect),
    )
  }
  expect(branches[2].connection).toBe(input.connections[1])
  expect(branches[2].connection.nominalTraceWidth).toBe(0.4)
  expect(branches[1].points[1]).toBe(input.connections[0].pointsToConnect[2])
  expect(JSON.stringify(input.connections)).toBe(originalConnections)
})
