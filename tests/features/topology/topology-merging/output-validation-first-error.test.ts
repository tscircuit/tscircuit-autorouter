import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createTopologyMergingValidationTestInput } from "../../../fixtures/createTopologyMergingValidationTestInput"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

test("topology output validation preserves the first invalid pair in input order", (): void => {
  const entries = Array.from({ length: 66 }, (_, index) => ({
    node: createTopologyMergingTestNode({
      id: `node-${index}`,
      bounds:
        index === 0
          ? { minX: 0, maxX: 100, minY: 0, maxY: 100 }
          : {
              minX: 90 - index,
              maxX: 90.5 - index,
              minY: 10,
              maxY: 10.5,
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
