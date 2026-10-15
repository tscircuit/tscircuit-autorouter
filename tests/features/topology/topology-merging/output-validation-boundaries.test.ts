import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createTopologyMergingValidationTestInput } from "../../../fixtures/createTopologyMergingValidationTestInput"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

test("topology output validation preserves layer, boundary, and same-group exceptions", (): void => {
  const entries = [
    { minX: 0, maxX: 2, availableZ: [0], groupIndex: 0 },
    { minX: 2, maxX: 4, availableZ: [0], groupIndex: 1 },
    { minX: 10, maxX: 12, availableZ: [0], groupIndex: 2 },
    { minX: 12 - 0.00002, maxX: 14, availableZ: [0], groupIndex: 3 },
    { minX: 20, maxX: 22, availableZ: [0], groupIndex: 4 },
    { minX: 20, maxX: 22, availableZ: [1], groupIndex: 5 },
    { minX: 30, maxX: 32, availableZ: [0], groupIndex: 6 },
    { minX: 31, maxX: 33, availableZ: [0], groupIndex: 6 },
    ...Array.from({ length: 32 }, (_, index) => ({
      minX: 100 + index * 3,
      maxX: 102 + index * 3,
      availableZ: [0],
      groupIndex: 100 + index,
    })),
  ].map(({ minX, maxX, availableZ, groupIndex }, index) => ({
    node: createTopologyMergingTestNode({
      id: `node-${index}`,
      bounds: {
        minX: minX - 40,
        maxX: maxX - 40,
        minY: -5,
        maxY: -3,
      },
      availableZ,
    }),
    groupIndex,
  }))

  expect(() =>
    validateTopologyMergingOutput(
      createTopologyMergingValidationTestInput(entries),
    ),
  ).not.toThrow()
  expect(() =>
    validateTopologyMergingOutput(
      createTopologyMergingValidationTestInput([]),
    ),
  ).not.toThrow()
})
