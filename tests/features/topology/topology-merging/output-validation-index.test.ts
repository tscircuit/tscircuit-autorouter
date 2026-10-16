import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { CapacityMeshNode } from "lib/types"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"
import { validateTopologyMergingOutputReference } from "../../../fixtures/validate-topology-merging-output-reference"

type ValidationInput = Parameters<typeof validateTopologyMergingOutput>[0]
type ValidationCase = {
  name: string
  input: ValidationInput
  shouldFail?: boolean
}

function createValidationInput(
  nodes: CapacityMeshNode[],
  groupIndexes: number[] = nodes.map((_, index) => index),
): ValidationInput {
  const preparedNodeBySourceKey = new Map<string, PreparedTopologyMergingNode>()
  const provenance = {
    sourceKeysByNodeId: new Map<string, string[]>(),
    groupIndexesByNodeId: new Map<string, number[]>(),
  }
  for (const [index, node] of nodes.entries()) {
    const sourceKey = `source-${index}`
    const groupIndex = groupIndexes[index]!
    preparedNodeBySourceKey.set(sourceKey, {
      sourceKey,
      groupIndex,
      node: structuredClone(node),
      bounds: getCapacityMeshNodeBounds(node),
    })
    provenance.sourceKeysByNodeId.set(node.capacityMeshNodeId, [sourceKey])
    provenance.groupIndexesByNodeId.set(node.capacityMeshNodeId, [groupIndex])
  }
  return { nodes, preparedNodeBySourceKey, provenance }
}

function createNode(
  id: string,
  minX: number,
  maxX: number,
  minY = 0,
  maxY = 2,
  availableZ = [0],
): CapacityMeshNode {
  return createTopologyMergingTestNode({
    id,
    bounds: { minX, maxX, minY, maxY },
    availableZ,
  })
}

function getValidationError(
  validate: (input: ValidationInput) => void,
  input: ValidationInput,
): string | null {
  try {
    validate(input)
    return null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return error.message
  }
}

test("indexed topology validation preserves exhaustive outcomes and first errors", (): void => {
  const cases: ValidationCase[] = [
    { name: "empty", input: createValidationInput([]), shouldFail: false },
    {
      name: "single node",
      input: createValidationInput([createNode("a", 0, 2)]),
      shouldFail: false,
    },
  ]
  for (const [name, b, shouldFail] of [
    ["separated x", createNode("b", 3, 5), false],
    ["separated y", createNode("b", 0, 2, 3, 5), false],
    ["touching edge", createNode("b", 2, 4), false],
    ["touching corner", createNode("b", 2, 4, 2, 4), false],
    ["overlap below epsilon", createNode("b", 2 - 2e-5, 4), false],
    ["overlap above epsilon", createNode("b", 2 - 8e-5, 4), true],
    ["overlap", createNode("b", 1, 3), true],
    ["contained", createNode("b", 0.5, 1.5, 0.5, 1.5), true],
    ["different layers", createNode("b", 1, 3, 0, 2, [1]), false],
    ["shared layer", createNode("b", 1, 3, 0, 2, [1, 0]), true],
  ] as const) {
    cases.push({
      name,
      input: createValidationInput([createNode("a", 0, 2), b]),
      shouldFail,
    })
  }
  const overlap = [createNode("a", 0, 2), createNode("b", 1, 3)]
  cases.push({
    name: "preserved overlap from distinct sources in one group",
    input: createValidationInput(structuredClone(overlap), [0, 0]),
    shouldFail: false,
  })
  for (const problem of [
    "missing source provenance",
    "missing overlapping group provenance",
    "missing source node",
    "source geometry escape",
    "source layer escape",
    "multi-group provenance",
    "same source overlap",
  ]) {
    const input = createValidationInput(structuredClone(overlap), [0, 0])
    if (problem === "missing source provenance") {
      input.provenance.sourceKeysByNodeId.delete("b")
    } else if (problem === "missing overlapping group provenance") {
      input.provenance.groupIndexesByNodeId.delete("b")
    } else if (problem === "missing source node") {
      input.preparedNodeBySourceKey = new Map()
    } else if (problem === "source geometry escape") {
      input.nodes[1]!.width += 1
    } else if (problem === "source layer escape") {
      input.nodes[1]!.availableZ.push(1)
    } else if (problem === "multi-group provenance") {
      input.provenance.groupIndexesByNodeId.set("b", [0, 1])
    } else {
      input.nodes[1] = structuredClone(input.nodes[0]!)
      input.nodes[1]!.capacityMeshNodeId = "b"
      input.provenance.sourceKeysByNodeId.set("b", ["source-0"])
    }
    cases.push({ name: problem, input, shouldFail: true })
  }
  const separatedMissingGroup = createValidationInput([
    createNode("a", 0, 2),
    createNode("b", 3, 5),
  ])
  separatedMissingGroup.provenance.groupIndexesByNodeId.delete("b")
  cases.push({
    name: "separated nodes do not require group provenance",
    input: separatedMissingGroup,
    shouldFail: false,
  })
  for (const problem of [
    "duplicate id",
    "zero width",
    "NaN",
    "infinite",
    "no layers",
  ]) {
    const nodes = [createNode("a", 0, 2), createNode("b", 1, 3)]
    if (problem === "duplicate id") nodes[1]!.capacityMeshNodeId = "a"
    if (problem === "zero width") nodes[1]!.width = 0
    if (problem === "NaN") nodes[1]!.center.x = Number.NaN
    if (problem === "infinite") nodes[1]!.center.y = Number.POSITIVE_INFINITY
    if (problem === "no layers") nodes[1]!.availableZ = []
    cases.push({
      name: problem,
      input: createValidationInput(nodes),
      shouldFail: true,
    })
  }
  cases.push({
    name: "small overlap at large coordinates retains float64 precision",
    input: createValidationInput([
      createNode("a", 1e9, 1e9 + 1),
      createNode("b", 1e9 + 1 - 8e-5, 1e9 + 2),
    ]),
    shouldFail: true,
  })
  cases.push({
    name: "multiple conflicts report the first pair in original node order",
    input: createValidationInput([
      createNode("first", -100, 100, -100, 100),
      ...Array.from({ length: 48 }, (_, index) =>
        createNode(`candidate-${index}`, 48 - index * 2, 49 - index * 2),
      ),
    ]),
    shouldFail: true,
  })
  for (let layout = 0; layout < 32; layout++) {
    const nodes = Array.from({ length: 48 }, (_, index) => {
      const x = ((index * 17 + layout * 3) % 19) * 1.25
      const y = ((index * 11 + layout) % 13) * 1.25
      return createNode(
        `node-${index}`,
        x,
        x + (layout % 2 === 0 ? 1 : 2),
        y,
        y + 2,
        [index % 3, (index + layout) % 4],
      )
    })
    for (let ordering = 0; ordering < 3; ordering++) {
      const reordered = ordering === 0 ? nodes : [...nodes].reverse()
      if (ordering === 2) reordered.push(...reordered.splice(0, 17))
      cases.push({
        name: `layout ${layout}, ordering ${ordering}`,
        input: createValidationInput(structuredClone(reordered)),
      })
    }
  }

  for (const { name, input, shouldFail } of cases) {
    const original = structuredClone(input)
    const expectedError = getValidationError(
      validateTopologyMergingOutputReference,
      input,
    )
    const actualError = getValidationError(validateTopologyMergingOutput, input)
    expect(actualError, name).toBe(expectedError)
    if (shouldFail !== undefined) {
      expect(actualError !== null, name).toBe(shouldFail)
    }
    expect(input, name).toEqual(original)
  }
})
