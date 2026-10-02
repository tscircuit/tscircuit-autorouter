import { distance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { DifferentialPair } from "lib/types/srj-types"

export function assertDifferentialPairLengthSkew({
  differentialPairs,
  hdRoutes,
}: {
  differentialPairs: DifferentialPair[]
  hdRoutes: HighDensityRoute[]
}): void {
  const LENGTH_COMPARISON_EPSILON_MM = 1e-6
  for (const pair of differentialPairs) {
    const lengths = pair.connectionNames.map((connectionName) => {
      const routes = hdRoutes.filter(
        (route) => route.connectionName === connectionName,
      )
      if (routes.length !== 1)
        throw new Error(
          `Differential pair connection "${connectionName}" requires exactly one routed segment`,
        )
      const route = routes[0]!.route
      return route
        .slice(1)
        .reduce(
          (total, point, index) => total + distance(point, route[index]!),
          0,
        )
    })
    const skew = Math.abs(lengths[0]! - lengths[1]!)
    if (skew > pair.lengthTolerance + LENGTH_COMPARISON_EPSILON_MM)
      throw new Error(
        `Differential pair ${pair.connectionNames.join("/")} routed skew ${skew}mm exceeds ${pair.lengthTolerance}mm`,
      )
  }
}
