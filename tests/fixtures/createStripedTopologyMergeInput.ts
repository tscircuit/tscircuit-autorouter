import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

export function createStripedTopologyMergeInput(count: number): TopologyMergingSolverParams {
  const globalNodes = Array.from({ length: count }, (_, i) => ({
    capacityMeshNodeId: `global_${i}`,
    center: { x: count / 2, y: i }, width: count, height: 1,
    availableZ: [0, 1, 2, 3], layer: "top",
  }))
  const componentNodes = Array.from({ length: count }, (_, i) => ({
    capacityMeshNodeId: `component_${i}`,
    center: { x: i + .25, y: i }, width: .1, height: .1,
    availableZ: [0], layer: "top", _isComponentTopologyNode: true,
    _containsTarget: true, _targetConnectionName: `net_${i}`,
  }))
  return { layerCount: 4, nodeGroups: [
    { groupId: "global", isComponent: false, nodes: globalNodes },
    { groupId: "components", isComponent: true, nodes: componentNodes },
  ] }
}
