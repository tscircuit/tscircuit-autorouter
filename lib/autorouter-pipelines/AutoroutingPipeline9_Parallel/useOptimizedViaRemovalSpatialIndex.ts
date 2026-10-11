import type { HighDensityRouteSpatialIndex as DependencySpatialIndex, UselessViaRemovalSolver } from "@tscircuit/trace-simplification-solver"
import { HighDensityRouteSpatialIndex } from "../../data-structures/HighDensityRouteSpatialIndex"
import type { HighDensityRoute } from "../../types/high-density-types"

type ViaRemovalSpatialOperations = Pick<DependencySpatialIndex,
  "addRoute" | "removeRoute" | "getConflictingRoutesForSegment" | "getConflictingRoutesNearPoint">

/** Replace only the fresh child's index; its route and section policy stays native. */
export const useOptimizedViaRemovalSpatialIndex = (
  solver: UselessViaRemovalSolver,
  otherHdRoutes: ReadonlyArray<HighDensityRoute>,
): void => {
  if (solver.iterations !== 0 || solver.activeSubSolver || solver.optimizedHdRoutes.length !== 0) {
    throw new Error("Via-removal spatial index must be installed before the child starts")
  }
  const index: ViaRemovalSpatialOperations = new HighDensityRouteSpatialIndex([
    ...solver.unsimplifiedHdRoutes, ...otherHdRoutes,
  ])
  // Both pinned classes implement the same checked public operations. Their
  // private bucket fields make the otherwise identical API nominal in TS.
  solver.hdRouteSHI = index as DependencySpatialIndex
}
