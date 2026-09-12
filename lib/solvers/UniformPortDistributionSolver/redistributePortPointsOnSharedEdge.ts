import type { PortPointWithOwnerPair, SharedEdge } from "./types"
import { redistributeUniformPortPointsOnSharedEdge } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { spreadUniformPortPoint } from "../../bindings/uniform-port-distribution/UniformPortDistributionLiveValues"

export const redistributePortPointsOnSharedEdge = (params: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
}): PortPointWithOwnerPair[] => {
  initializeAutorouterBindings()
  return redistributeUniformPortPointsOnSharedEdge(params, spreadUniformPortPoint)
}
