import { expect, test } from "bun:test"
import { PadJunctionSimplificationSolver } from "lib/solvers/PadJunctionSimplificationSolver/PadJunctionSimplificationSolver"
import { createPadJunctionFixture } from "../fixtures/pad-junction"

test("the application stage rejects a later T that shares an already replaced route", () => {
  const input = createPadJunctionFixture()
  input.obstacles.push({ ...input.obstacles[0]!, center: { x: 0, y: 10 } })
  input.hdRoutes[0]!.route = [
    { x: 0, y: 0, z: 0 },
    { x: -2, y: 4, z: 0 },
    { x: -2, y: 6, z: 0 },
    { x: 0, y: 10, z: 0 },
  ]
  input.hdRoutes.push({
    ...input.hdRoutes[1]!,
    connectionName: "branch2",
    route: [
      { x: 2, y: 6, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
  })
  const before = structuredClone(input.hdRoutes)
  const solver = new PadJunctionSimplificationSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const proposals = solver.constructPadTsSolver.getOutput()
  expect(proposals).toHaveLength(2)
  expect(proposals.every(({ result }) => !("outcome" in result))).toBe(true)
  expect(solver.outcomes.map(({ outcome }) => outcome)).toEqual([
    "accepted",
    "unsupported",
  ])
  expect(solver.getOutput()[0]!.route.slice(-2)).toEqual(
    before[0]!.route.slice(-2),
  )
  expect(solver.getOutput()[2]).toEqual(before[2])
  expect(input.hdRoutes).toEqual(before)
})
