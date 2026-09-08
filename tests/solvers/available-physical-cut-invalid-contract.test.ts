import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {
  type AvailablePhysicalCutInput,
  createAvailablePhysicalCutInput,
} from "../fixtures/tinygraph/createAvailablePhysicalCutInput"

type InvalidCutCase = {
  input: AvailablePhysicalCutInput
  message: string
}

test("physical cut consumption rejects missing, repeated, mismatched and non-adjacent source contracts", (): void => {
  const cases: InvalidCutCase[] = []
  const missingNode = createAvailablePhysicalCutInput()
  missingNode.physicalNodeCuts = {
    ...missingNode.physicalNodeCuts,
    cuts: [{ physicalCutId: "cut", nodeIds: ["first", "missing"] }],
  }
  cases.push({
    input: missingNode,
    message: 'Physical node cut "cut" has invalid nodes',
  })

  const sameNode = createAvailablePhysicalCutInput()
  sameNode.physicalNodeCuts = {
    ...sameNode.physicalNodeCuts,
    cuts: [{ physicalCutId: "cut", nodeIds: ["first", "first"] }],
  }
  cases.push({
    input: sameNode,
    message: 'Physical node cut "cut" has invalid nodes',
  })

  const noEdge = createAvailablePhysicalCutInput()
  noEdge.edges = []
  cases.push({
    input: noEdge,
    message: 'Physical node cut "finite-shared-cut" has no shared graph edge',
  })

  const nonAdjacent = createAvailablePhysicalCutInput()
  nonAdjacent.nodes[1]!.center.y = 8
  cases.push({
    input: nonAdjacent,
    message: 'Physical node cut "finite-shared-cut" has no shared graph edge',
  })

  const repeatedResource = createAvailablePhysicalCutInput()
  repeatedResource.physicalNodeCuts = {
    ...repeatedResource.physicalNodeCuts,
    cuts: [
      ...repeatedResource.physicalNodeCuts.cuts,
      { physicalCutId: "finite-shared-cut", nodeIds: ["second", "first"] },
    ],
  }
  cases.push({
    input: repeatedResource,
    message: "Physical node cuts require distinct resource IDs",
  })

  const repeatedPair = createAvailablePhysicalCutInput()
  repeatedPair.physicalNodeCuts = {
    ...repeatedPair.physicalNodeCuts,
    cuts: [
      ...repeatedPair.physicalNodeCuts.cuts,
      { physicalCutId: "another-cut", nodeIds: ["second", "first"] },
    ],
  }
  cases.push({
    input: repeatedPair,
    message: "Physical node cuts cannot repeat a shared node pair",
  })

  const repeatedEdge = createAvailablePhysicalCutInput()
  repeatedEdge.edges.push({
    capacityMeshEdgeId: "duplicate-edge",
    nodeIds: ["second", "first"],
  })
  cases.push({
    input: repeatedEdge,
    message: 'Physical node cut "finite-shared-cut" has repeated edges',
  })

  const widthMismatch = createAvailablePhysicalCutInput()
  widthMismatch.traceWidth = 0.25
  cases.push({
    input: widthMismatch,
    message: "Physical node cuts must use the shared-edge trace width",
  })

  const invalidId = createAvailablePhysicalCutInput()
  invalidId.physicalNodeCuts = {
    ...invalidId.physicalNodeCuts,
    cuts: [{ physicalCutId: "", nodeIds: ["first", "second"] }],
  }
  cases.push({ input: invalidId, message: "Invalid physicalCutId" })

  for (const { input, message } of cases) {
    const before = structuredClone(input)
    expect((): void => {
      const solver = new AvailableSegmentPointSolver(input)
      solver.solve()
    }).toThrow(message)
    expect(input).toEqual(before)
  }
})
