import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export const mergePipeline9MovablePreloadedVias = ({
  routes,
  otherHdRoutes,
  obstacles,
  colorMap,
  layerCount,
  connMap,
}: {
  routes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
}): HighDensityRoute[] => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes,
    otherHdRoutes,
    obstacles,
    colorMap,
    layerCount,
    connMap,
  })
  solver.solve()
  if (solver.failed) {
    throw new Error(
      `Pipeline9 could not merge movable preloaded vias: ${solver.error ?? "unknown error"}`,
    )
  }
  return solver.getMergedViaHdRoutes() ?? routes
}
