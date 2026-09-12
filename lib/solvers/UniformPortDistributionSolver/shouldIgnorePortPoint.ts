import type { PortPoint } from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import type { OwnerPair } from "./types"
import { shouldIgnoreUniformPortPoint } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"

import { findUniformInputNode, findUniformInputPoint } from "../../bindings/uniform-port-distribution/UniformPortDistributionLiveValues"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodes: InputNodeWithPortPoints[]
}

export const shouldIgnorePortPoint = (params: ShouldIgnorePortPointParams): boolean => {
  initializeAutorouterBindings()
  return shouldIgnoreUniformPortPoint(params, findUniformInputNode, findUniformInputPoint)
}
