import type {
  NodeWithPortPoints,
  PortPoint,
} from "../../lib/types/high-density-types"

export const createFlexibleBoundaryFixture = (): NodeWithPortPoints[] => {
  const pairsA: [PortPoint, PortPoint][] = []
  const pairsB: [PortPoint, PortPoint][] = []
  for (const index of [0, 1]) {
    const common = {
      connectionName: `connection-${index}`,
      rootConnectionName: `root-${index}`,
      y: index === 0 ? -0.4 : 0.4,
      z: 0,
    }
    const left = {
      ...common,
      x: 0,
      portPointId: `left-${index}`,
      pcb_port_id: `physical-left-${index}`,
    }
    const shared = { ...common, x: 1, portPointId: `seam-${index}` }
    const right = {
      ...common,
      x: 2,
      portPointId: `right-${index}`,
      pcb_port_id: `physical-right-${index}`,
    }
    pairsA.push(index === 0 ? [left, shared] : [shared, left])
    pairsB.push(index === 0 ? [{ ...shared }, right] : [right, { ...shared }])
  }
  return [
    {
      capacityMeshNodeId: "left",
      center: { x: 0.5, y: 0 },
      width: 1,
      height: 2,
      availableZ: [0, 1],
      portPoints: pairsA.flat(),
      portPointsInPairs: pairsA,
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 1.5, y: 0 },
      width: 1,
      height: 2,
      availableZ: [0, 1],
      portPoints: pairsB.flat(),
      portPointsInPairs: pairsB,
    },
  ]
}
