import type { Obstacle } from "lib/types"
import type { SharedEdge } from "./types"
import { shouldIgnoreUniformSharedEdge } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"

import { readUniformObstacleScalars } from "../../bindings/uniform-port-distribution/UniformPortDistributionLiveValues"

export const shouldIgnoreSharedEdge = (params: {
  sharedEdge: SharedEdge
  obstacles: Obstacle[]
}): boolean => {
  initializeAutorouterBindings()
  return shouldIgnoreUniformSharedEdge(params, readUniformObstacleScalars)
}
