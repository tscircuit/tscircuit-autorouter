import { expect, test } from "bun:test"
import {
  CoupledPortPlacementSolver,
  type CoupledPortPlacementInput,
  type CoupledPortPlacementVariable,
} from "lib/solvers/UniformPortDistributionSolver/CoupledPortPlacementSolver"

test("coupled placement preserves diagonal, disconnected, anchored and closed-domain solutions", (): void => {
  const variable = (
    id: string,
    dx: number,
    dy: number,
  ): CoupledPortPlacementVariable => ({
    id,
    x: 0,
    y: 0,
    dx,
    dy,
    domains: [[0, 0.16]],
    preferred: 0,
  })
  const input: CoupledPortPlacementInput = {
    variables: [variable("horizontal", 1, 0), variable("vertical", 0, 1)],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: 0.2 }],
  }
  const snapshot = structuredClone(input)
  const diagonal = new CoupledPortPlacementSolver(input)
  expect(diagonal.MAX_ITERATIONS).toBe(100000)
  diagonal.solve()
  expect(diagonal.solved).toBe(true)
  const [x, y] = diagonal.getOutput()
  expect(x!).toBeGreaterThan(0)
  expect(y!).toBeGreaterThan(0)
  expect(x!).toBeLessThan(0.2)
  expect(y!).toBeLessThan(0.2)
  expect(Math.hypot(x!, y!)).toBeGreaterThanOrEqual(0.2)
  expect(input).toEqual(snapshot)

  const parallel = new CoupledPortPlacementSolver({
    variables: [
      {
        ...variable("lower-face", 0, 1),
        y: -0.1,
        domains: [[0, 0.1]],
        preferred: 0.05,
      },
      {
        ...variable("upper-face", 0, 1),
        x: 0.1,
        domains: [[0, 0.1]],
        preferred: 0.05,
      },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: 0.195 }],
  })
  parallel.solve()
  expect(parallel.solved).toBe(true)
  const [lower, upper] = parallel.getOutput()
  expect(lower!).toBeLessThan(0.05)
  expect(upper!).toBeGreaterThan(0.05)
  expect(Math.hypot(0.1, 0.1 + upper! - lower!)).toBeGreaterThanOrEqual(0.195)

  const ordered = new CoupledPortPlacementSolver({
    variables: [
      {
        ...variable("first", 1, 0),
        domains: [
          [0, 0],
          [0.3, 0.5],
        ],
      },
      {
        ...variable("second", 1, 0),
        domains: [
          [0.1, 0.2],
          [0.7, 0.8],
        ],
        preferred: 0.1,
      },
      { ...variable("fixed", 0, 0), x: 0.35, domains: [[0, 0]] },
    ],
    orderConstraints: [{ first: 0, second: 1, gap: 0.25 }],
    distanceConstraints: [
      { first: 0, second: 2, gap: 0.2 },
      { first: 1, second: 2, gap: 0.2 },
    ],
  })
  ordered.solve()
  expect(ordered.getOutput()).toEqual([0, 0.7, 0])

  const nested = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("fixed", 0, 0), domains: [[0, 0]] },
      {
        ...variable("nested", 1, 0),
        domains: [
          [0, 10],
          [5, 6],
        ],
      },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: 8 }],
  })
  nested.solve()
  expect(nested.getOutput()[1]!).toBeGreaterThanOrEqual(8)

  const tangent = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("left", 0, 0), domains: [[0, 0]] },
      { ...variable("right", 0, 0), x: 1, domains: [[0, 0]] },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: 1 }],
  })
  tangent.solve()
  expect(tangent.getOutput()).toEqual([0, 0])
  const circularTangent = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("center", 0, 0), domains: [[0, 0]] },
      { ...variable("circle-tangent", 1, 0), y: 1, domains: [[1, 1]] },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: Math.SQRT2 }],
  })
  circularTangent.solve()
  expect(circularTangent.getOutput()).toEqual([0, 1])
  const low = 0.1,
    high = low + 1e-12
  const tiny = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("tiny", 1, 0), domains: [[low, high]], preferred: low },
    ],
    orderConstraints: [],
    distanceConstraints: [],
    solutionValidator: ([position]) => position === high,
  })
  tiny.solve()
  expect(tiny.getOutput()).toEqual([high])
  expect(tiny.stats.rejectedCandidates).toBeGreaterThan(0)

  const impossible = new CoupledPortPlacementSolver({
    ...input,
    variables: input.variables.map((point) => ({
      ...point,
      domains: [[0, 0]],
    })),
  })
  impossible.solve()
  expect(impossible.failed).toBe(true)
  expect(impossible.solved).toBe(false)
  expect(impossible.error).toContain("UNRESOLVED")
  expect(() => impossible.getOutput()).toThrow("UNRESOLVED")
  const precision = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("precision", 1, 0), domains: [[1, 1 + Number.EPSILON]] },
    ],
    orderConstraints: [],
    distanceConstraints: [],
    solutionValidator: () => false,
  })
  precision.solve()
  expect(precision.failed).toBe(true)
  expect(precision.error).toContain("UNRESOLVED")
  expect(precision.stats.precisionLimitedBoxes).toBe(1)
  const budget = new CoupledPortPlacementSolver({
    variables: [
      { ...variable("a", 1, 0), domains: [[0, 1]], preferred: 0.5 },
      { ...variable("b", 1, 0), domains: [[0, 1]], preferred: 0.5 },
    ],
    orderConstraints: [],
    distanceConstraints: [{ first: 0, second: 1, gap: 0.8 }],
  })
  budget.MAX_ITERATIONS = 1
  expect(() => budget.solve()).toThrow("UNRESOLVED")
  expect(budget.failed).toBe(true)
  expect(budget.solved).toBe(false)
  expect(budget.iterations).toBe(1)
  expect(budget.error).toContain("UNRESOLVED")
  expect(() => new CoupledPortPlacementSolver({
    ...input, variables: [input.variables[0]!, { ...input.variables[1]!, id: "horizontal" }],
  })).toThrow("identity")
})
