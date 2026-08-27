import type {
  AllowedZByConnectionName,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const addAllowedZToPortPoint = ({
  portPoint,
  allowedZByConnectionName,
}: {
  portPoint: PortPoint
  allowedZByConnectionName: AllowedZByConnectionName
}): PortPoint => {
  const allowedZ = allowedZByConnectionName[portPoint.connectionName]
  return allowedZ ? { ...portPoint, allowedZ } : portPoint
}

export const addPipeline9ConnectionAllowedZToPortPoints = ({
  nodes,
  allowedZByConnectionName,
}: {
  nodes: NodeWithPortPoints[]
  allowedZByConnectionName: AllowedZByConnectionName
}): NodeWithPortPoints[] =>
  nodes.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((portPoint) =>
      addAllowedZToPortPoint({ portPoint, allowedZByConnectionName }),
    ),
    portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
      addAllowedZToPortPoint({ portPoint: start, allowedZByConnectionName }),
      addAllowedZToPortPoint({ portPoint: end, allowedZByConnectionName }),
    ]),
  }))
