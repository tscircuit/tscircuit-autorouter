import { PortfolioSingleIntraNodeSolver } from "./PortfolioSingleIntraNodeSolver"

/** Uses the legacy portfolio after grow-and-shrink has enlarged a node. */
export class CoarseGridPortfolioSingleIntraNodeSolver extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const combinations = super.getCombinationDefs()
    return combinations.filter(
      ([combination]) => combination !== "highDensityA11",
    )
  }
}
