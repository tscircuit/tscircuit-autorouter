import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import stringify from "fast-json-stable-stringify"
import type { DrcEvaluator } from "high-density-repair03/lib"
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
  let beforeErrors = before
  if (!Array.isArray(beforeErrors)) beforeErrors = beforeErrors.errors
  if (!beforeErrors.some((error) => error.type === "pcb_via_clearance_error")) {
    return routes
  }
  const netByConnectionName = getPipeline9NetByConnectionName(
    [...routes, ...otherHdRoutes], connMap,
  )
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes,
    otherHdRoutes,
    netByConnectionName,
    obstacles,
    colorMap,
    layerCount,
    connMap,
    preserveRouteEndpoints: true,
  })
  solver.solve()
  if (solver.failed) throw new Error(solver.error ?? "Via merge failed")
  const candidate = solver.getMergedViaHdRoutes()
  if (!candidate) throw new Error("Via merger completed without routes")
  let accepted = routes
  for (const net of new Set(netByConnectionName.values())) {
    const proposed = accepted.map((route, index) => {
      if (netByConnectionName.get(route.connectionName) === net) return candidate[index]!
      return route
    })
    if (stringify(proposed) === stringify(accepted)) continue
    const after = drcEvaluator({ traces: [], routes: proposed, hdRoutes: proposed })
    let afterErrors = after
    if (!Array.isArray(afterErrors)) afterErrors = afterErrors.errors
    if (afterErrors.length >= beforeErrors.length) continue
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
    if (!unchangedErrors) continue
    accepted = proposed
    beforeErrors = afterErrors
  }
  return accepted
}
