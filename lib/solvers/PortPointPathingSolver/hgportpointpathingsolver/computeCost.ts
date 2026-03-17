import { Region } from "@tscircuit/hypergraph"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

export const computeCostPerRegion = (region: Region) => {
  if (!region.assignments || region.assignments.length === 0) {
    if (region.d?.assignment) return 0
    return 1
  }

  const existingPortPoints = region.assignments.flatMap((assignment) => {
    const region1PortPoint = assignment.regionPort1.d
    const region2PortPoint = assignment.regionPort2.d
    const connectionName = assignment.connection.connectionId
    const rootConnectionName = assignment.connection.mutuallyConnectedNetworkId
    return [
      {
        x: region1PortPoint.x,
        y: region1PortPoint.y,
        z: region1PortPoint.z,
        connectionName,
        rootConnectionName,
      },
      {
        x: region2PortPoint.x,
        y: region2PortPoint.y,
        z: region2PortPoint.z,
        connectionName,
        rootConnectionName,
      },
    ]
  })
  const nodeWithPortPoints = {
    ...region.d,
    portPoints: existingPortPoints,
  }
  const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)

  const pf = calculateNodeProbabilityOfFailure(
    region.d,
    crossings.numSameLayerCrossings,
    crossings.numEntryExitLayerChanges,
    crossings.numTransitionPairCrossings,
  )
  return pf
}
