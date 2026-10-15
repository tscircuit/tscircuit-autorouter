import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createTopologyMergingValidationTestInput } from "../../../fixtures/createTopologyMergingValidationTestInput"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

test("topology output validation still rejects overlaps above the provenance tolerance", (): void => {
  const entries = [
    { minX: 0, maxX: 2 },
    { minX: 2 - 0.00005, maxX: 4 },
    ...Array.from({ length: 32 }, (_, index) => ({
      minX: 100 + index * 3,
      maxX: 102 + index * 3,
    })),
  ].map(({ minX, maxX }, index) => ({
    node: createTopologyMergingTestNode({
      id: `node-${index}`,
      bounds: {
        minX: minX - 10,
        maxX: maxX - 10,
        minY: -5,
        maxY: -3,
      },
      availableZ: [0],
    }),
    groupIndex: index,
  }))

  expect(() =>
    validateTopologyMergingOutput(
      createTopologyMergingValidationTestInput(entries),
    ),
  ).toThrow(
    'TopologyMergingSolver: output nodes "node-0" and "node-1" have an unresolved inter-group overlap on a shared layer',
  )
})
