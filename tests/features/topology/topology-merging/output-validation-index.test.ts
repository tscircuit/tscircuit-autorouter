import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { createTopologyMergingTestNode } from "../../../fixtures/topology-merging-test-utils"
import { validateTopologyMergingOutputReference } from "../../../fixtures/validateTopologyMergingOutputReference"

type ValidationInput = Parameters<typeof validateTopologyMergingOutput>[0]
type TopologyMergingSourceKey = PreparedTopologyMergingNode["sourceKey"]
type CreateNodeOptions = {
  id: CapacityMeshNodeId
  minX: number
  maxX: number
  minY?: number
  maxY?: number
  availableZ?: number[]
}
type ValidationCase = {
  name: string
  input: ValidationInput
  shouldFail?: boolean
}

function createValidationInput(
  nodes: CapacityMeshNode[],
  groupIndexes: number[] = nodes.map((_, index) => index),
): ValidationInput {
  const preparedNodeBySourceKey = new Map<
    TopologyMergingSourceKey,
    PreparedTopologyMergingNode
  >()
  const provenance = {
    sourceKeysByNodeId: new Map<CapacityMeshNodeId, TopologyMergingSourceKey[]>(),
    groupIndexesByNodeId: new Map<CapacityMeshNodeId, number[]>(),
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

function createNode({
  id,
  minX,
  maxX,
  minY = 0,
  maxY = 2,
  availableZ = [0],
}: CreateNodeOptions): CapacityMeshNode {
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
      input: createValidationInput([createNode({ id: "a", minX: 0, maxX: 2 })]),
      shouldFail: false,
    },
  ]
  for (const [name, b, shouldFail] of [
    ["separated x", createNode({ id: "b", minX: 3, maxX: 5 }), false],
    [
      "separated y",
      createNode({ id: "b", minX: 0, maxX: 2, minY: 3, maxY: 5 }),
      false,
    ],
    ["touching edge", createNode({ id: "b", minX: 2, maxX: 4 }), false],
    [
      "touching corner",
      createNode({ id: "b", minX: 2, maxX: 4, minY: 2, maxY: 4 }),
      false,
    ],
    [
      "overlap below epsilon",
      createNode({ id: "b", minX: 2 - 2e-5, maxX: 4 }),
      false,
    ],
    [
      "overlap above epsilon",
      createNode({ id: "b", minX: 2 - 8e-5, maxX: 4 }),
      true,
    ],
    ["overlap", createNode({ id: "b", minX: 1, maxX: 3 }), true],
    [
      "contained",
      createNode({ id: "b", minX: 0.5, maxX: 1.5, minY: 0.5, maxY: 1.5 }),
      true,
    ],
    [
      "different layers",
      createNode({ id: "b", minX: 1, maxX: 3, availableZ: [1] }),
      false,
    ],
    [
      "shared layer",
      createNode({ id: "b", minX: 1, maxX: 3, availableZ: [1, 0] }),
      true,
    ],
  ] as const) {
    cases.push({
      name,
      input: createValidationInput([createNode({ id: "a", minX: 0, maxX: 2 }), b]),
      shouldFail,
    })
  }
  const overlap = [
    createNode({ id: "a", minX: 0, maxX: 2 }),
    createNode({ id: "b", minX: 1, maxX: 3 }),
  ]
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
      input.preparedNodeBySourceKey = new Map<
        TopologyMergingSourceKey,
        PreparedTopologyMergingNode
      >()
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
    createNode({ id: "a", minX: 0, maxX: 2 }),
    createNode({ id: "b", minX: 3, maxX: 5 }),
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
    const nodes = [
      createNode({ id: "a", minX: 0, maxX: 2 }),
      createNode({ id: "b", minX: 1, maxX: 3 }),
    ]
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
      createNode({ id: "a", minX: 1e9, maxX: 1e9 + 1 }),
      createNode({ id: "b", minX: 1e9 + 1 - 8e-5, maxX: 1e9 + 2 }),
    ]),
    shouldFail: true,
  })
  cases.push({
    name: "multiple conflicts report the first pair in original node order",
    input: createValidationInput([
      createNode({
        id: "first",
        minX: -100,
        maxX: 100,
        minY: -100,
        maxY: 100,
      }),
      ...Array.from({ length: 48 }, (_, index) =>
        createNode({
          id: `candidate-${index}`,
          minX: 48 - index * 2,
          maxX: 49 - index * 2,
        }),
      ),
    ]),
    shouldFail: true,
  })
  for (let layout = 0; layout < 32; layout++) {
    const nodes = Array.from({ length: 48 }, (_, index) => {
      const x = ((index * 17 + layout * 3) % 19) * 1.25
      const y = ((index * 11 + layout) % 13) * 1.25
      return createNode({
        id: `node-${index}`,
        minX: x,
        maxX: x + (layout % 2 === 0 ? 1 : 2),
        minY: y,
        maxY: y + 2,
        availableZ: [index % 3, (index + layout) % 4],
      })
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
