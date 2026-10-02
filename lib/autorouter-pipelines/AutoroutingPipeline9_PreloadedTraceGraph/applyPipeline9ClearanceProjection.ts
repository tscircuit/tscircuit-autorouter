import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  Pipeline9ClearanceProjectionSolver,
  type Pipeline9ClearanceProjectionParams,
} from "./Pipeline9ClearanceProjectionSolver"

/** Opens coupled copper gaps while keeping terminals, junctions and widths fixed. */
export const applyPipeline9ClearanceProjection = (
  params: Pipeline9ClearanceProjectionParams,
): HighDensityRoute[] => {
  const solver = new Pipeline9ClearanceProjectionSolver(params)
  while (!solver.solved && !solver.failed) solver.step()
  if (solver.failed) {
    throw new Error(`Clearance projection failed: ${solver.error}`)
  }
  return solver.getOutput()
}
