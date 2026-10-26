import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("global proof options relax physical widths and boundary precision without changing placement defaults", (): void => {
  const ports = [
    {
      owner: "a",
      connectionName: "a",
      width: 0.5,
      allowed: [[0, 0]] as [number, number][],
    },
    {
      owner: "b",
      connectionName: "b",
      width: 0.5,
      allowed: [[0.25, 0.25]] as [number, number][],
    },
  ]
  const rules = { length: 1, traceClearance: 0, tolerance: 0 }
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports }).feasible).toBe(false)
  expect(
    getOrderedSharedEdgeSchedule({ ...rules, ports, minimumProofWidth: 0.25 })
      .feasible,
  ).toBe(true)
  const almostTangent = [
    ports[0]!,
    {
      ...ports[1]!,
      width: 0.25,
      allowed: [[0.25 - 1e-10, 0.25 - 1e-10]] as [number, number][],
    },
  ]
  expect(
    getOrderedSharedEdgeSchedule({
      ...rules,
      ports: almostTangent,
      minimumProofWidth: 0.25,
    }).feasible,
  ).toBe(false)
  expect(
    getOrderedSharedEdgeSchedule({
      ...rules,
      ports: almostTangent,
      minimumProofWidth: 0.25,
      proofSlack: 1e-9,
    }).feasible,
  ).toBe(true)
  expect(ports[0]!.width).toBe(0.5)
  expect(() =>
    getOrderedSharedEdgeSchedule({ ...rules, ports, proofSlack: -1 }),
  ).toThrow("Invalid ordered shared-edge scheduling rules")
})
