import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

export const mergePipeline9SameNetVias = ({
  routes,
  otherHdRoutes,
  obstacles,
  colorMap,
  layerCount,
  connMap,
  preserveRouteEndpoints = false,
}: {
  routes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  preserveRouteEndpoints?: boolean
}): HighDensityRoute[] => {
  const netByConnectionName = getPipeline9NetByConnectionName(
    [...routes, ...otherHdRoutes],
    connMap,
  )
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes,
    otherHdRoutes,
    netByConnectionName,
    obstacles,
    colorMap,
    layerCount,
    connMap,
    preserveRouteEndpoints,
  })
  solver.solve()
  if (solver.failed) {
    throw new Error(
      `Pipeline9 could not merge same-net vias: ${solver.error ?? "unknown error"}`,
    )
  }
  return solver.getMergedViaHdRoutes() ?? routes
}
