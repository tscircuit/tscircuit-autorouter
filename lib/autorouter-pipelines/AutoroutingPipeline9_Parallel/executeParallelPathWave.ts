import { MultiSimplifiedPathSolver, type SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ParallelPathWaveJob, ParallelPathWaveResult } from "./parallelStageWorkerTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import { preserveLeadingPathLayerTransitions } from "./preserveLeadingPathLayerTransitions"

type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]
type Workspace = {
  contextId: number
  solver: MultiSimplifiedPathSolver
  index: GeometryIndex
  completed: Array<HighDensityRoute | undefined>
  indexed: HighDensityRoute[]
}

/** Per-thread native geometry index; a new phase always starts from original copper. */
export class ParallelPathWaveExecutor {
  private workspace: Workspace | undefined

  execute(job: ParallelPathWaveJob): ParallelPathWaveResult {
    if (job.context) {
      const solver = new MultiSimplifiedPathSolver({
        ...job.context.params,
        connMap: restoreWorkerConnectivityMap(job.context),
      })
      if (job.context.params.preserveLeadingLayerTransitions) preserveLeadingPathLayerTransitions(solver)
      const index = (solver as unknown as { geometryIndex: GeometryIndex }).geometryIndex
      this.workspace = { contextId: job.contextId, solver, index,
        completed: new Array(solver.unsimplifiedHdRoutes.length), indexed: [...solver.unsimplifiedHdRoutes] }
    }
    const workspace = this.workspace
    if (!workspace || workspace.contextId !== job.contextId) throw new Error(`Missing path simplification context ${job.contextId}`)
    const { solver, index, completed, indexed } = workspace
    for (const update of job.updates) {
      if (!Number.isInteger(update.index) || update.index < 0 || update.index >= completed.length) throw new Error("Invalid completed simplification index")
      completed[update.index] = update.route
    }
    const results: ParallelPathWaveResult["results"] = []
    let previousIndex = -1
    for (const routeIndex of job.indexes) {
      if (!Number.isInteger(routeIndex) || routeIndex <= previousIndex || routeIndex >= completed.length) throw new Error("Path wave indexes must be valid and ascending")
      if (completed[routeIndex]) throw new Error(`Path simplification route ${routeIndex} was already completed`)
      previousIndex = routeIndex
      // Later routes always retain their original geometry. Earlier independent
      // unfinished paths cannot affect this job, and remain original too.
      for (let peer = 0; peer < indexed.length; peer++) {
        const desired = peer < routeIndex && completed[peer] ? completed[peer]! : solver.unsimplifiedHdRoutes[peer]!
        if (indexed[peer] !== desired) {
          index.replaceRoute(peer, desired)
          indexed[peer] = desired
        }
      }
      solver.currentUnsimplifiedHdRouteIndex = routeIndex
      solver.simplifiedHdRoutes = solver.unsimplifiedHdRoutes.slice(0, routeIndex).map((route, peer) => completed[peer] ?? route)
      solver.iterations = 0
      solver.solved = false
      solver.step()
      while (solver.activeSubSolver && !solver.failed) solver.step()
      if (solver.failed || solver.solved) throw new Error(`Native path route ${routeIndex} failed: ${solver.error}`)
      const route = solver.simplifiedHdRoutes[routeIndex]
      if (!route || solver.simplifiedHdRoutes.length !== routeIndex + 1) throw new Error(`Native simplification omitted route ${routeIndex}`)
      completed[routeIndex] = route
      indexed[routeIndex] = route
      results.push({ index: routeIndex, route, nativeSteps: solver.iterations })
    }
    return { kind: "simplifyPathWave", contextId: job.contextId, results }
  }
}
