import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { createDisjointTopologyValidationInput } from "./fixtures/createDisjointTopologyValidationInput"

test("topology output validation avoids a quadratic scan of disjoint nodes", (): void => {
  const { input, geometryReads } = createDisjointTopologyValidationInput(256)
  expect({ rects: input.nodes.map(node => createRectFromCapacityNode(node, { rectMargin: 0.02 })) }).toMatchGraphicsSvg(import.meta.path)
  geometryReads.count = 0
  validateTopologyMergingOutput(input)
  expect(geometryReads.count).toBeLessThanOrEqual(input.nodes.length * 20)
})
