import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import stringify from "fast-json-stable-stringify"
import type { DrcError, DrcEvaluator } from "high-density-repair03/lib"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

export const applyPipeline9SameNetViaRepairs = ({
  routes,
  otherHdRoutes,
  obstacles,
  colorMap,
  layerCount,
  connMap,
  drcEvaluator,
}: {
  routes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  const before = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  let beforeErrors: DrcError[]
  if (Array.isArray(before)) {
    beforeErrors = before
  } else {
    beforeErrors = before.errors
  }
  if (!beforeErrors.some((error) => error.type === "pcb_via_clearance_error")) {
    return routes
  }
  const netByConnectionName = getPipeline9NetByConnectionName(
    [...routes, ...otherHdRoutes], connMap,
  )
  const mergeRoutes = (
    inputHdRoutes: HighDensityRoute[],
    fixedRoutes: HighDensityRoute[],
  ): HighDensityRoute[] => {
    const solver = new SameNetViaMergerSolver({
      inputHdRoutes,
      otherHdRoutes: fixedRoutes,
      netByConnectionName,
      obstacles,
      colorMap,
      layerCount,
      connMap,
      preserveRouteEndpoints: true,
    })
    solver.solve()
    if (solver.failed) throw new Error(solver.error ?? "Via merge failed")
    const merged = solver.getMergedViaHdRoutes()
    if (!merged) throw new Error("Via merger completed without routes")
    return merged
  }
  const candidate = mergeRoutes(routes, otherHdRoutes)
  let accepted = routes
  const acceptImprovement = (proposed: HighDensityRoute[]): boolean => {
    if (stringify(proposed) === stringify(accepted)) return false
    const after = drcEvaluator({ traces: [], routes: proposed, hdRoutes: proposed })
    let afterErrors = after
    if (!Array.isArray(afterErrors)) afterErrors = afterErrors.errors
    if (afterErrors.length >= beforeErrors.length) return false
    const unmatched = [...beforeErrors]
    const unchangedErrors = afterErrors.every((error) => {
      const index = unmatched.findIndex((original) => {
        if (error.type !== original.type) return false
        // Via numbering changes when vias are removed. Compare the physical
        // conflict instead, including its exact measured clearance.
        if (error.type === "pcb_via_trace_clearance_error") {
          return stringify([error.center, error.pcb_trace_id, error.actual_clearance, error.minimum_clearance]) === stringify([original.center, original.pcb_trace_id, original.actual_clearance, original.minimum_clearance])
        }
        if (error.type === "pcb_via_clearance_error") {
          return stringify([error.pcb_center, error.actual_clearance, error.minimum_clearance]) === stringify([original.pcb_center, original.actual_clearance, original.minimum_clearance])
        }
        return stringify(error) === stringify(original)
      })
      if (index === -1) return false
      unmatched.splice(index, 1)
      return true
    })
    if (!unchangedErrors) return false
    accepted = proposed
    beforeErrors = afterErrors
    return true
  }
  for (const net of new Set(netByConnectionName.values())) {
    const proposed = accepted.map((route, index) => {
      if (netByConnectionName.get(route.connectionName) === net) return candidate[index]!
      return route
    })
    if (acceptImprovement(proposed)) continue
    // A blocked merge elsewhere on this net must not discard an independent repair.
    for (let index = 0; index < accepted.length; index++) {
      const route = accepted[index]!
      if (netByConnectionName.get(route.connectionName) !== net) continue
      if (stringify(candidate[index]) === stringify(routes[index])) continue
      const fixedRoutes = [
        ...otherHdRoutes,
        ...accepted.filter((_, routeIndex) => routeIndex !== index),
      ]
      const merged = mergeRoutes([route], fixedRoutes)
      const localCandidate = [...accepted]
      localCandidate[index] = merged[0]!
      if (stringify(localCandidate) === stringify(proposed)) continue
      acceptImprovement(localCandidate)
    }
  }
  return accepted
}
