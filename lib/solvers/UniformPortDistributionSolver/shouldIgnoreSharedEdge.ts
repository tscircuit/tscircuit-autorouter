import type { Obstacle } from "lib/types"
import type { SharedEdge } from "./types"
import { shouldIgnoreUniformSharedEdge } from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"

import { readUniformObstacleScalars } from "lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues"

export const shouldIgnoreSharedEdge = (params: {
  sharedEdge: SharedEdge
  obstacles: Obstacle[]
}): boolean => {
  initializeAutorouterBindings()
  return shouldIgnoreUniformSharedEdge(params, readUniformObstacleScalars)
}
