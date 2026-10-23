import type { MHPoint2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver3 } from "./MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

/** Project gradient proposals before an exponential boundary force can diverge. */
export class ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver extends MultiHeadPolyLineIntraNodeSolver3 {
  protected override integrateViaBoundary(
    point: MHPoint2,
    forceX: number,
    forceY: number,
  ): { x: number; y: number; fx: number; fy: number } {
    if (![point.x, point.y, forceX, forceY, this.viaDiameter, this.BOUNDARY_PADDING, ...Object.values(this.bounds)].every(Number.isFinite)) {
      throw new Error("Projected polyline boundary received nonfinite geometry or force")
    }
    // Radius is counted once. Negative padding retains its existing meaning:
    // this candidate may explore the declared amount past the copper boundary.
    const margin = this.viaDiameter / 2 + this.BOUNDARY_PADDING
    const minX = this.bounds.minX + margin, maxX = this.bounds.maxX - margin
    const minY = this.bounds.minY + margin, maxY = this.bounds.maxY - margin
    // An empty center interval has a unique symmetric least-violation point.
    // This is a force update, never a clearance or feasibility certificate.
    const x = minX <= maxX ? Math.max(minX, Math.min(maxX, point.x + forceX)) : this.bounds.minX / 2 + this.bounds.maxX / 2
    const y = minY <= maxY ? Math.max(minY, Math.min(maxY, point.y + forceY)) : this.bounds.minY / 2 + this.bounds.maxY / 2
    const fx = x - point.x, fy = y - point.y
    if (![x, y, fx, fy].every(Number.isFinite)) throw new Error("Projected polyline boundary arithmetic exceeded finite coordinates")
    this.stats.projectedViaBoundarySteps = Number(this.stats.projectedViaBoundarySteps ?? 0) + 1
    this.stats.projectedViaBoundaryEmptyAxes = Number(this.stats.projectedViaBoundaryEmptyAxes ?? 0) + Number(minX > maxX) + Number(minY > maxY)
    this.stats.projectedViaBoundaryMoves = Number(this.stats.projectedViaBoundaryMoves ?? 0) + Number(fx !== 0 || fy !== 0)
    return { x, y, fx, fy }
  }
}
