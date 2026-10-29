import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createTopologyValidationInput } from "../../../fixtures/createTopologyValidationInput"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

type BoundaryCase = {
  name: string
  x: number
  y: number
  originX?: number
  availableZ: number[]
  sameGroup?: boolean
  rejects: boolean
}

test("topology validation preserves layer, touching, tolerance and provenance rules", (): void => {
  const cases: BoundaryCase[] = [
    { name: "separate x", x: 3, y: 0, availableZ: [0], rejects: false },
    { name: "separate y", x: 0, y: 3, availableZ: [0], rejects: false },
    { name: "edge", x: 2, y: 0, availableZ: [0], rejects: false },
    { name: "corner", x: 2, y: 2, availableZ: [0], rejects: false },
    { name: "overlap", x: 1, y: 0, availableZ: [0], rejects: true },
    { name: "other layer", x: 1, y: 0, availableZ: [1], rejects: false },
    { name: "shared layer", x: 1, y: 0, availableZ: [1, 0], rejects: true },
    {
      name: "below tolerance",
      x: 2 - 2e-5,
      y: 0,
      availableZ: [0],
      rejects: false,
    },
    {
      name: "above tolerance",
      x: 2 - 8e-5,
      y: 0,
      availableZ: [0],
      rejects: true,
    },
    {
      name: "large coordinates",
      originX: 1e9,
      x: 1e9 + 2 - 8e-5,
      y: 0,
      availableZ: [0],
      rejects: true,
    },
    {
      name: "preserved same-group overlap",
      x: 1,
      y: 0,
      availableZ: [0],
      sameGroup: true,
      rejects: false,
    },
  ]
  for (const scenario of cases) {
    const originX = scenario.originX ?? 0
    const nodes = [
      createTopologyMergingTestNode({
        id: "a",
        bounds: { minX: originX, maxX: originX + 2, minY: 0, maxY: 2 },
        availableZ: [0],
      }),
      createTopologyMergingTestNode({
        id: "b",
        bounds: {
          minX: scenario.x,
          maxX: scenario.x + 2,
          minY: scenario.y,
          maxY: scenario.y + 2,
        },
        availableZ: scenario.availableZ,
      }),
    ]
    const input = createTopologyValidationInput({
      nodes,
      groupIndexes: scenario.sameGroup ? [0, 0] : [0, 1],
    })
    const original = structuredClone(input)
    if (scenario.rejects) {
      expect(() => validateTopologyMergingOutput(input), scenario.name).toThrow(
        'output nodes "a" and "b" have an unresolved inter-group overlap',
      )
    } else {
      expect(
        () => validateTopologyMergingOutput(input),
        scenario.name,
      ).not.toThrow()
    }
    expect(input, scenario.name).toEqual(original)
  }
  expect(() =>
    validateTopologyMergingOutput(createTopologyValidationInput({ nodes: [] })),
  ).not.toThrow()
})
