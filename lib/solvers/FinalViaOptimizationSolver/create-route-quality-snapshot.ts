import type { DrcEvaluator } from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type RouteQualitySnapshot = {
  productionDrcErrorCount: number
  productionDrcIssueScore: number
  relaxedDrcErrorCount: number
  outputViaCount: number
  totalTraceLength: number
}

const getTraceLength = (traces: SimplifiedPcbTraces): number => {
  let length = 0
  for (const trace of traces) {
    let previousWire: { x: number; y: number; layer: string } | undefined
    for (const segment of trace.route) {
      if (segment.route_type !== "wire") {
        previousWire = undefined
        continue
      }
      if (previousWire && previousWire.layer === segment.layer) {
        length += Math.hypot(
          segment.x - previousWire.x,
          segment.y - previousWire.y,
        )
      }
      previousWire = segment
    }
  }
  return length
}

/** Creates the production-output quality tuple used for transactional acceptance. */
export const createRouteQualitySnapshot = ({
  hdRoutes,
  srj,
  convert,
  productionDrcEvaluator,
  relaxedDrcEvaluator,
}: {
  hdRoutes: HighDensityRoute[]
  srj: SimpleRouteJson
  convert: (routes: HighDensityRoute[]) => SimplifiedPcbTraces
  productionDrcEvaluator: DrcEvaluator
  relaxedDrcEvaluator: DrcEvaluator
}): RouteQualitySnapshot => {
  const traces = convert(hdRoutes)
  const productionSnapshot = getDrcSnapshot(
    srj as any,
    hdRoutes as any,
    productionDrcEvaluator as any,
  )
  const relaxedSnapshot = getDrcSnapshot(
    srj as any,
    hdRoutes as any,
    relaxedDrcEvaluator as any,
  )

  return {
    productionDrcErrorCount: productionSnapshot.count,
    productionDrcIssueScore: productionSnapshot.issueScore,
    relaxedDrcErrorCount: relaxedSnapshot.count,
    outputViaCount: traces.reduce(
      (count, trace) =>
        count +
        trace.route.filter((segment) => segment.route_type === "via").length,
      0,
    ),
    totalTraceLength: getTraceLength(traces),
  }
}
