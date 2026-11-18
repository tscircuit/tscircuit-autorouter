import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RegionalForceImproveParams = ConstructorParameters<
  typeof HighDensityForceImproveSolver
>[0] & {
  isViaClearanceValid: (routes: HighDensityRoute[]) => boolean
}

export class RegionalForceImproveSolver extends HighDensityForceImproveSolver {
  private readonly isViaClearanceValid: (routes: HighDensityRoute[]) => boolean
  private rejectedNodeCount: number

  constructor(params: RegionalForceImproveParams) {
    const { isViaClearanceValid, ...forceParams } = params
    super(forceParams)
    this.isViaClearanceValid = isViaClearanceValid
    this.rejectedNodeCount = 0
    this.stats.rejectedNodeCount = 0
  }

  override _step(): void {
    const entry = this.sampleEntries[this.activeSampleIndex]
    super._step()
    if (entry && !this.isViaClearanceValid(this.getOutput())) {
      // A node's routes move together; preserve the valid candidate as a unit.
      for (const routeIndex of entry.routeIndexes) {
        this.improvedRoutesByIndex.delete(routeIndex)
      }
      this.rejectedNodeCount += 1
    }
    this.stats.improvedRouteCount = this.improvedRoutesByIndex.size
    this.stats.rejectedNodeCount = this.rejectedNodeCount
  }
}
