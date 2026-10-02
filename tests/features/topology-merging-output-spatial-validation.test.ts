import { expect, test } from "bun:test"
import { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { CapacityMeshNode } from "lib/types"

test("validates only spatially overlapping topology output nodes", () => {
  const nodes: CapacityMeshNode[] = Array.from({ length: 2_000 }, (_, index) => ({
    capacityMeshNodeId: `node_${index}`,
    center: { x: index * 2, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
  }))
  nodes.push({
    capacityMeshNodeId: "overlapping_node",
    center: { x: 2_000, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
  })
  const provenance = {
    groupIndexesByNodeId: new Map(
      nodes.map((node, index) => [node.capacityMeshNodeId, [index]]),
    ),
    sourceKeysByNodeId: new Map(
      nodes.map((node, index) => [
        node.capacityMeshNodeId,
        [`source_${index}_a`, `source_${index}_b`],
      ]),
    ),
  }

  expect(() =>
    validateTopologyMergingOutput({
      nodes,
      preparedNodeBySourceKey: new Map(),
      provenance,
    }),
  ).toThrow("have an unresolved inter-group overlap")
})
