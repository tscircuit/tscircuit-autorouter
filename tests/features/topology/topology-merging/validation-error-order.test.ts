import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createTopologyValidationInput } from "../../../fixtures/createTopologyValidationInput"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"

test("topology validation reports the first original pair and validates every node first", (): void => {
  const nodes = [
    createTopologyMergingTestNode({
      id: "first",
      bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      availableZ: [0],
    }),
    ...Array.from({ length: 48 }, (_, index) =>
      createTopologyMergingTestNode({
        id: `candidate-${index}`,
        bounds: {
          minX: 48 - index * 2,
          maxX: 49 - index * 2,
          minY: 0,
          maxY: 1,
        },
        availableZ: [0],
      }),
    ),
  ]
  const input = createTopologyValidationInput({ nodes })
  expect(() => validateTopologyMergingOutput(input)).toThrow(
    'output nodes "first" and "candidate-0" have an unresolved inter-group overlap',
  )
  input.provenance.sourceKeysByNodeId.delete("candidate-47")
  expect(() => validateTopologyMergingOutput(input)).toThrow(
    'missing output provenance for node "candidate-47"',
  )
})
