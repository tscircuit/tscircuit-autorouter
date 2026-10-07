import { expect, test } from "bun:test"
import {
  type TopologyMergingOutputProvenance,
  validateTopologyMergingOutput,
} from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNode } from "lib/types"

const createValidationInput = (nodes: CapacityMeshNode[]) => {
  const preparedNodeBySourceKey = new Map<string, PreparedTopologyMergingNode>()
  const provenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map(),
    sourceKeysByNodeId: new Map(),
  }
  for (const [nodeIndex, node] of nodes.entries()) {
    const sourceKey = `group_${nodeIndex}:${node.capacityMeshNodeId}`
    preparedNodeBySourceKey.set(sourceKey, {
      sourceKey,
      groupIndex: nodeIndex,
      node,
      bounds: {
        minX: node.center.x - node.width / 2,
        minY: node.center.y - node.height / 2,
        maxX: node.center.x + node.width / 2,
        maxY: node.center.y + node.height / 2,
      },
    })
    provenance.groupIndexesByNodeId.set(node.capacityMeshNodeId, [nodeIndex])
    provenance.sourceKeysByNodeId.set(node.capacityMeshNodeId, [sourceKey])
  }
  return { preparedNodeBySourceKey, provenance }
}

test("topology output validation handles a large sparse mesh", (): void => {
  const nodes: CapacityMeshNode[] = Array.from(
    { length: 12_000 },
    (_, nodeIndex) => ({
      capacityMeshNodeId: `node_${nodeIndex}`,
      center: { x: nodeIndex * 2, y: 0 },
      width: 1,
      height: 1,
      layer: "z0",
      availableZ: [0],
    }),
  )
  const validationInput = createValidationInput(nodes)

  expect(() =>
    validateTopologyMergingOutput({ nodes, ...validationInput }),
  ).not.toThrow()
})

test("topology output validation still rejects shared-layer overlaps", (): void => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "node_a",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "node_b",
      center: { x: 0.5, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0],
    },
  ]
  const validationInput = createValidationInput(nodes)

  expect(() =>
    validateTopologyMergingOutput({ nodes, ...validationInput }),
  ).toThrow("unresolved inter-group overlap")
})
