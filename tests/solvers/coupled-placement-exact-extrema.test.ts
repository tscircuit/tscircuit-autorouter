import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  CoupledPortPlacementSolver,
  type CoupledPortPlacementInput,
} from "lib/solvers/UniformPortDistributionSolver/CoupledPortPlacementSolver"

test("coupled placement discards impossible guarded frontiers without losing closed extrema", (): void => {
  // Exact nine-event component captured after 13,573 Uniform phase steps.
  // The old guarded contractors spend the remaining phase budget in dead strips.
  const input: CoupledPortPlacementInput = JSON.parse(readFileSync(
    new URL("../fixtures/sample24/coupled-order-frontier.json", import.meta.url),
    "utf8",
  ))
  const original = structuredClone(input)
  const solver = new CoupledPortPlacementSolver(input)
  solver.solve()
  expect(solver.MAX_ITERATIONS).toBe(100000)
  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBeLessThan(86427)
  const positions = solver.getOutput()
  for (const [index, variable] of input.variables.entries()) {
    expect(variable.domains.some(([low, high]) =>
      positions[index]! >= low && positions[index]! <= high,
    )).toBe(true)
  }
  for (const constraint of input.orderConstraints) {
    expect(positions[constraint.second]! - positions[constraint.first]!)
      .toBeGreaterThanOrEqual(constraint.gap)
  }
  for (const constraint of input.distanceConstraints) {
    const first = input.variables[constraint.first]!
    const second = input.variables[constraint.second]!
    expect(Math.hypot(
      first.x + first.dx * positions[constraint.first]! -
        (second.x + second.dx * positions[constraint.second]!),
      first.y + first.dy * positions[constraint.first]! -
        (second.y + second.dy * positions[constraint.second]!),
    )).toBeGreaterThanOrEqual(constraint.gap)
  }
  expect(input).toEqual(original)

  // Subtracting the gap from .5 rounds below .105, while the exact final
  // subtraction .5 - .105 equals .395. Keep this inclusive order solution.
  const orderedTangent = new CoupledPortPlacementSolver({
    variables: [
      { id: "first", x: 256, y: 128, dx: 1, dy: 0, domains: [[0.105, 0.105]], preferred: 0.105 },
      { id: "second", x: 256, y: 128, dx: 1, dy: 0, domains: [[0.5, 0.5]], preferred: 0.5 },
    ],
    orderConstraints: [{ first: 0, second: 1, gap: 0.395 }],
    distanceConstraints: [],
  })
  orderedTangent.solve()
  expect(orderedTangent.getOutput()).toEqual([0.105, 0.5])

  // Farthest-corner proofs also retain tangencies under reflected axes,
  // disconnected domains and large translated world coordinates.
  for (const origin of [0, 2 ** 40]) {
    const reflected = new CoupledPortPlacementSolver({
      variables: [
        { id: "fixed", x: origin, y: origin, dx: 0, dy: 0, domains: [[0, 0]], preferred: 0 },
        { id: "reflected", x: origin, y: origin, dx: -1, dy: 0, domains: [[0, 0], [1, 1]], preferred: 0 },
      ],
      orderConstraints: [],
      distanceConstraints: [{ first: 0, second: 1, gap: 1 }],
    })
    reflected.solve()
    expect(reflected.getOutput()).toEqual([0, 1])
  }
  const circularTangent = new CoupledPortPlacementSolver({
    variables: [
      { id: "fixed", x: 0, y: 0, dx: 0, dy: 0, domains: [[0, 0]], preferred: 0 },
      { id: "reflected", x: 0, y: 1, dx: -1, dy: 0, domains: [[-1, -1]], preferred: -1 },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: Math.SQRT2 }],
  })
  circularTangent.solve()
  expect(circularTangent.getOutput()).toEqual([0, -1])
})
