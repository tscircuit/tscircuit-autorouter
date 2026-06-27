import type {
  CapacityMeshNode,
  ComponentPortPoint,
  ComponentPortPointSide,
} from "lib/types"

export function createSideCenteredComponentPortPoints(
  node: CapacityMeshNode,
): ComponentPortPoint[] {
  const leftX = node.center.x - node.width / 2
  const rightX = node.center.x + node.width / 2
  const topY = node.center.y - node.height / 2
  const bottomY = node.center.y + node.height / 2
  const centerX = node.center.x
  const centerY = node.center.y
  const availableZ = [...node.availableZ]
  const sidePoints: Array<{
    side: ComponentPortPointSide
    x: number
    y: number
  }> = [
    { side: "top", x: centerX, y: topY },
    { side: "right", x: rightX, y: centerY },
    { side: "bottom", x: centerX, y: bottomY },
    { side: "left", x: leftX, y: centerY },
  ]

  return sidePoints.map(({ side, x, y }) => ({
    componentPortPointId: `${node.capacityMeshNodeId}_${side}`,
    capacityMeshNodeId: node.capacityMeshNodeId,
    side,
    x,
    y,
    availableZ,
  }))
}
