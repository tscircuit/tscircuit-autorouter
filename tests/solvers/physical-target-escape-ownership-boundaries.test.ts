import { expect, test } from "bun:test"
import { getNodeEdgeMap } from "lib/solvers/CapacityMeshSolver/getNodeEdgeMap"
import { hasPhysicalTargetRoutingEscape } from "lib/solvers/CapacityMeshSolver/hasPhysicalTargetRoutingEscape"
import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { CapacityMeshNode } from "lib/types"
import type { PhysicalTargetRegion } from "lib/types/capacity-mesh-types"

test("physical target escapes require proven copper identity, layer and existing shared borders", (): void => {
  const region: PhysicalTargetRegion = {
    id: "physical-pad",
    connectionName: "signal",
    center: { x: 1.5, y: 0.5 },
    width: 3,
    height: 1,
    availableZ: [0],
  }
  const target: CapacityMeshNode = {
    capacityMeshNodeId: "target",
    center: { x: 0.5, y: 0.5 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "signal",
    _physicalTargetRegions: [region],
  }
  const copper: CapacityMeshNode = {
    ...target,
    capacityMeshNodeId: "copper",
    center: { x: 2, y: 0.5 },
    width: 2,
    _targetConnectionName: undefined,
  }
  const outside: CapacityMeshNode = {
    capacityMeshNodeId: "outside",
    center: { x: 3.5, y: 0.5 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
  }
  const cases: Array<{
    bridge: CapacityMeshNode
    edges: Array<[string, string]>
    expected: boolean
  }> = [
    {
      bridge: copper,
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: true,
    },
    {
      bridge: copper,
      edges: [["target", "copper"]],
      expected: false,
    },
    {
      bridge: {
        ...copper,
        _physicalTargetRegions: [{ ...region, id: "other-pad" }],
      },
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: false,
    },
    {
      bridge: { ...copper, layer: "z1", availableZ: [1] },
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: false,
    },
    {
      bridge: {
        ...copper,
        _containsObstacle: false,
        _containsTarget: false,
        _physicalTargetRegions: undefined,
      },
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: false,
    },
    {
      bridge: copper,
      edges: [["copper", "outside"]],
      expected: false,
    },
    {
      bridge: { ...copper, center: { x: 1.5, y: 1.5 }, width: 1 },
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: false,
    },
    {
      bridge: { ...copper, center: { x: 1.75, y: 0.5 }, width: 2.5 },
      edges: [
        ["target", "copper"],
        ["copper", "outside"],
      ],
      expected: false,
    },
  ]
  for (const { bridge, edges, expected } of cases) {
    const nodes = [target, bridge, outside]
    expect(
      hasPhysicalTargetRoutingEscape({
        targetNode: target,
        nodeById: new Map(nodes.map((node) => [node.capacityMeshNodeId, node])),
        nodeBounds: new Map(
          nodes.map((node) => [
            node.capacityMeshNodeId,
            getCapacityMeshNodeBounds(node),
          ]),
        ),
        edgesByNodeId: getNodeEdgeMap(
          edges.map((nodeIds, index) => ({
            capacityMeshEdgeId: String(index),
            nodeIds,
          })),
        ),
      }),
    ).toBe(expected)
  }
})
