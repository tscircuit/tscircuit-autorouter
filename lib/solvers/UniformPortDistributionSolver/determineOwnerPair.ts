import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { decodeName, encodeName, encodeInputNodes } from "lib/bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { determineUniformPortOwnerPair } from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
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
    portPointId: portPointId == null ? null : encodeName(portPointId),
    currentNodeId: encodeName(currentNodeId),
    inputNodes: encodeInputNodes(inputNodes),
  })
  return [decodeName(pair[0]), decodeName(pair[1])]
}
