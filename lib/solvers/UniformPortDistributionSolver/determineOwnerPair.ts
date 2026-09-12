import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { decodeName, encodeName, encodeInputNodes, type EncodedName } from "../../bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { determineUniformPortOwnerPair } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { OwnerPair } from "./types"

interface DetermineOwnerPairParams {
  portPointId?: string
  currentNodeId: string
  inputNodes: InputNodeWithPortPoints[]
}

/**
 * Resolves the canonical two-node ownership for a port point so shared-edge
 * redistribution can always operate on a stable family identity.
 */
export const determineOwnerPair = ({
  portPointId,
  currentNodeId,
  inputNodes,
}: DetermineOwnerPairParams): OwnerPair => {
  initializeAutorouterBindings()
  const pair = determineUniformPortOwnerPair({
    portPointId: portPointId == null ? undefined : encodeName(portPointId),
    currentNodeId: encodeName(currentNodeId),
    inputNodes: encodeInputNodes(inputNodes),
  }) as [EncodedName, EncodedName]
  return pair.map(decodeName) as OwnerPair
}
