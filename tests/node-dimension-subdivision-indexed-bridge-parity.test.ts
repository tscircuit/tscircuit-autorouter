import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"

type BridgeCase = {
  axis: "horizontal" | "vertical"
  gap: number
  x: number
  bridgeDimension: number
}

const createNode = (
  overrides: Partial<CapacityMeshNode>,
): CapacityMeshNode => ({
  capacityMeshNodeId: "bridge",
  center: { x: 0, y: 0 },
  width: 0.2,
  height: 0.04,
  layer: "top",
  availableZ: [0],
  ...overrides,
})

// Preserve the original full-input bridge scan as the parity oracle. These
// cases disable subdivision so the complete ordered output is this list.
const getLinearRetainedNodes = ({
  nodes,
  minNodeArea,
}: {
  nodes: CapacityMeshNode[]
  minNodeArea: number
}): CapacityMeshNode[] => {
  return nodes.filter((node) => {
    if (!Number.isFinite(node.width) || !Number.isFinite(node.height)) {
      return false
    }
    if (
      !Number.isFinite(minNodeArea) ||
      minNodeArea <= 0 ||
      node.width * node.height >= minNodeArea
    ) {
      return true
    }
    if (Math.min(node.width, node.height) < 0.002) return false
    if (node._containsTarget) return true
    let borderingNodeCount = 0
    for (const candidate of nodes) {
      if (candidate.capacityMeshNodeId === node.capacityMeshNodeId) continue
      if (!node.availableZ.some((z) => candidate.availableZ.includes(z))) {
        continue
      }
      if (!areNodesBordering(node, candidate)) continue
      if (candidate._containsTarget) return true
      borderingNodeCount++
      if (borderingNodeCount >= 2) return true
    }
    return false
  })
}

const createBorderCase = ({
  axis,
  gap,
  x,
  bridgeDimension,
}: BridgeCase): CapacityMeshNode[] => {
  const width = axis === "horizontal" ? bridgeDimension : 0.2
  const height = axis === "horizontal" ? 4 : bridgeDimension
  return [
    createNode({
      capacityMeshNodeId: "before",
      center: {
        x: x - (axis === "horizontal" ? width / 2 + 0.1 + gap : 0),
        y: axis === "vertical" ? -(height / 2 + 0.1 + gap) : 0,
      },
      width: axis === "horizontal" ? 0.2 : width,
      height: axis === "vertical" ? 0.2 : height,
    }),
    createNode({ center: { x, y: 0 }, width, height }),
    createNode({
      capacityMeshNodeId: "after",
      center: {
        x: x + (axis === "horizontal" ? width / 2 + 0.1 + gap : 0),
        y: axis === "vertical" ? height / 2 + 0.1 + gap : 0,
      },
      width: axis === "horizontal" ? 0.2 : width,
      height: axis === "vertical" ? 0.2 : height,
    }),
  ]
}

const createDistantNodes = (): CapacityMeshNode[] => {
  return Array.from({ length: 40 }, (_, index) =>
    createNode({
      capacityMeshNodeId: `distant-${index}`,
      center: { x: 100 + index, y: 100 + (index % 3) },
      width: 0.2,
      height: 0.2,
    }),
  )
}

test("indexed bridges match complete ordered linear output", (): void => {
  const cases: CapacityMeshNode[][] = []
  for (const axis of ["horizontal", "vertical"] as const) {
    for (const gap of [0, 0.0009999999, 0.001, 0.0010000001, 0.002]) {
      for (const x of [-0.4, 0, 0.4, 1e12, Number.MAX_VALUE]) {
        for (const bridgeDimension of [0.0019999999, 0.002, 0.0020000001]) {
          cases.push(createBorderCase({ axis, gap, x, bridgeDimension }))
        }
      }
    }
  }
  const neighbors = createBorderCase({
    axis: "vertical",
    gap: 0,
    x: 0,
    bridgeDimension: 0.04,
  })
  for (const overlap of [0.0009999999, 0.001, 0.0010000001]) {
    cases.push(
      neighbors.map((node) => ({
        ...node,
        center: {
          ...node.center,
          x: node.capacityMeshNodeId === "bridge" ? 0 : 0.2 - overlap,
        },
      })),
    )
  }
  cases.push(
    neighbors.map((node) => ({
      ...node,
      availableZ: node.capacityMeshNodeId === "after" ? [1] : [0],
    })),
    neighbors.map((node) => ({
      ...node,
      _containsTarget: node.capacityMeshNodeId === "before",
      availableZ: node.capacityMeshNodeId === "after" ? [1] : [0],
    })),
    neighbors.map((node) => ({ ...node, availableZ: [1, 0] })),
    neighbors.map((node) => ({
      ...node,
      capacityMeshNodeId:
        node.capacityMeshNodeId === "before" ? "bridge" : node.capacityMeshNodeId,
    })),
    neighbors.map((node) => ({
      ...node,
      capacityMeshNodeId:
        node.capacityMeshNodeId === "bridge" ? "bridge" : "repeated-neighbor",
    })),
    [createNode({ _containsTarget: true })],
    [createNode({ center: { x: Number.NaN, y: 0 } })],
    [createNode({ center: { x: Number.POSITIVE_INFINITY, y: 0 } })],
  )
  for (const original of [
    { width: Number.POSITIVE_INFINITY, height: 0.2, center: { x: 0, y: 0.12 } },
    { width: 0.2, height: Number.POSITIVE_INFINITY, center: { x: 0.2, y: 0 } },
    { width: -0.4, height: 0.2, center: { x: 0.1, y: 0 } },
    { width: 0.2, height: -0.2, center: { x: 0, y: 0.08 } },
    { width: 0, height: 0.2, center: { x: 0.1, y: 0 } },
    { width: 0.2, height: 0, center: { x: 0, y: 0.02 } },
    { width: Number.NaN, height: 0.2, center: { x: 0.1, y: 0 } },
    { width: 0.2, height: Number.NaN, center: { x: 0, y: 0.02 } },
    { width: -Infinity, height: 0.2, center: { x: 0, y: 0.12 } },
    { width: Infinity, height: 0.2, center: { x: Infinity, y: 0.12 } },
  ]) {
    cases.push([
      createNode({}),
      createNode({
        ...original,
        capacityMeshNodeId: "unusual-original",
        _containsTarget: true,
      }),
    ])
  }
  for (const axis of ["x", "y"] as const) {
    for (const centerSign of [-1, 1]) {
      for (const dimensionSign of [-1, 1]) {
        const bridge = createNode({
          center: {
            x: axis === "x" ? (centerSign * Number.MAX_VALUE) / 2 : 0,
            y: axis === "y" ? (centerSign * Number.MAX_VALUE) / 2 : 0,
          },
        })
        const original = createNode({
          capacityMeshNodeId: "finite-overflow-original",
          center: {
            x: axis === "x" ? centerSign * Number.MAX_VALUE : 0,
            y: axis === "y" ? centerSign * Number.MAX_VALUE : 0,
          },
          width: axis === "x" ? dimensionSign * Number.MAX_VALUE : 0.2,
          height: axis === "y" ? dimensionSign * Number.MAX_VALUE : 0.2,
          _containsTarget: true,
        })
        expect(areNodesBordering(bridge, original)).toBe(true)
        cases.push([bridge, original])
      }
    }
  }

  for (const originalNodes of cases) {
    // More than one Flatbush leaf forces traversal order to differ from input.
    const nodes = [
      ...createDistantNodes().slice(0, 20),
      ...originalNodes,
      ...createDistantNodes().slice(20),
    ]
    const unchangedNodes = structuredClone(nodes)
    for (const node of nodes) {
      Object.freeze(node.center)
      Object.freeze(node.availableZ)
      Object.freeze(node)
    }
    Object.freeze(nodes)
    for (const minNodeArea of [0.1 ** 2, 0, Number.POSITIVE_INFINITY]) {
      const expectedNodes = getLinearRetainedNodes({ nodes, minNodeArea })
      const solver = new NodeDimensionSubdivisionSolver(
        nodes,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        minNodeArea,
      )
      solver.solve()
      expect(solver.outputNodes).toEqual(expectedNodes)
      expect(nodes).toEqual(unchangedNodes)
    }
  }
})
