import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"

test("topology merging does not restore a component target onto a fully covered source layer", (): void => {
  const targetGeometry = {
    center: { x: -6.800000000000001, y: -6 },
    width: 0.4,
    height: 0.4,
    _containsObstacle: true,
    _containsTarget: true,
  }
  const globalTarget: CapacityMeshNode = {
    ...targetGeometry,
    capacityMeshNodeId: "fixed-top-target",
    layer: "z0",
    availableZ: [0],
    _connectedTo: ["pcb_port_18"],
  }
  const componentTarget: CapacityMeshNode = {
    ...targetGeometry,
    capacityMeshNodeId: "component-target",
    layer: "z0,1",
    availableZ: [0, 1],
    _targetConnectionName: "source_net_76",
  }
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    nodeGroups: [
      { groupId: "global", nodes: [globalTarget], isComponent: false },
      { groupId: "cpu", nodes: [componentTarget], isComponent: true },
    ],
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const componentRegions = output.filter((node) => node._isComponentTopologyNode)
  expect(componentRegions).toHaveLength(1)
  expect(componentRegions[0]).toMatchObject({
    center: targetGeometry.center,
    availableZ: [1],
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "source_net_76",
  })
  expect(output.find((node) => node.capacityMeshNodeId === "fixed-top-target"))
    .toMatchObject({ availableZ: [0], _connectedTo: ["pcb_port_18"] })
})
