import { HighDensityForceImproveSolver as StockHighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { preconditionNewCrossings } from "./preconditionNewCrossings"

/**
 * Re-runs stock force improvement from a lightly separated input whenever the
 * first pass introduces a new proper trace crossing inside a capacity node.
 */
export class HighDensityForceImproveSolver extends StockHighDensityForceImproveSolver {
  private getRoutesForSample(routeIndexes: number[]): HighDensityRoute[] {
    return routeIndexes.map((routeIndex) => {
      const route = this.originalHdRoutes[routeIndex]
      if (!route) {
        throw new Error(`Missing high-density route at index ${routeIndex}`)
      }
      return route
    })
  }

  override _step(): void {
    const sampleIndex = this.activeSampleIndex
    super._step()
    const sampleEntry = this.sampleEntries[sampleIndex]
    if (!sampleEntry) return

    const rawRoutes = this.getRoutesForSample(sampleEntry.routeIndexes)
    const baselineRoutes = sampleEntry.routeIndexes.map(
      (routeIndex, localIndex) =>
        this.improvedRoutesByIndex.get(routeIndex) ?? rawRoutes[localIndex]!,
    )
    const preconditioned = preconditionNewCrossings({
      rawRoutes,
      baselineRoutes,
      node: sampleEntry.node,
    })
    if (preconditioned.barrierCount === 0) return

    const guardedSolver = new StockHighDensityForceImproveSolver({
      nodeWithPortPoints: [sampleEntry.node],
      hdRoutes: preconditioned.routes,
      totalStepsPerNode: this.totalStepsPerNode,
      nodeAssignmentMargin: this.nodeAssignmentMargin,
      colorMap: this.colorMap,
    })
    guardedSolver.solve()
    const guardedRoutes = guardedSolver.getOutput()
    for (let index = 0; index < sampleEntry.routeIndexes.length; index += 1) {
      const routeIndex = sampleEntry.routeIndexes[index]
      const guardedRoute = guardedRoutes[index]
      if (routeIndex === undefined || !guardedRoute) continue
      this.improvedRoutesByIndex.set(routeIndex, guardedRoute)
    }
  }
}
