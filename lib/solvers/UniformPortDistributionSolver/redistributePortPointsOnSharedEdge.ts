import type { PortPointWithOwnerPair, SharedEdge } from "./types"
import { redistributeUniformPortPointsOnSharedEdge } from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { spreadUniformPortPoint } from "lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues"

export const redistributePortPointsOnSharedEdge = (params: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
}): PortPointWithOwnerPair[] => {
  initializeAutorouterBindings()
  return redistributeUniformPortPointsOnSharedEdge(
    params,
    spreadUniformPortPoint,
  )
}
