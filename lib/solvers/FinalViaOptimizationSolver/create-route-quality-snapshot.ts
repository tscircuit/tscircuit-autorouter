import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type DrcResult =
  | Array<Record<string, unknown>>
  | { errors: Array<Record<string, unknown>> }

export type RouteQualitySnapshot = {
  productionDrcErrorCount: number
  productionDrcIssueScore: number
  relaxedDrcErrorCount: number
  outputViaCount: number
  totalTraceLength: number
}

const getErrors = (result: DrcResult): Array<Record<string, unknown>> =>
  Array.isArray(result) ? result : result.errors

const getIssueSeverity = (error: Record<string, unknown>): number => {
  if (typeof error.severity === "number") return error.severity
  if (error.severity === "error") return 3
  if (error.severity === "warning") return 2
  return 1
}

const getTraceLength = (traces: SimplifiedPcbTraces): number => {
  let length = 0
  for (const trace of traces) {
    let previousWire:
      | { x: number; y: number; layer: string }
      | undefined
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
  convert,
  productionDrcEvaluator,
  relaxedDrcEvaluator,
}: {
  hdRoutes: HighDensityRoute[]
  convert: (routes: HighDensityRoute[]) => SimplifiedPcbTraces
  productionDrcEvaluator: DrcEvaluator
  relaxedDrcEvaluator: DrcEvaluator
}): RouteQualitySnapshot => {
  const traces = convert(hdRoutes)
  const productionErrors = getErrors(
    productionDrcEvaluator({ traces: traces as any, routes: hdRoutes }) as DrcResult,
  )
  const relaxedErrors = getErrors(
    relaxedDrcEvaluator({ traces: traces as any, routes: hdRoutes }) as DrcResult,
  )

  return {
    productionDrcErrorCount: productionErrors.length,
    productionDrcIssueScore: productionErrors.reduce(
      (score, error) => score + getIssueSeverity(error),
      0,
    ),
    relaxedDrcErrorCount: relaxedErrors.length,
    outputViaCount: traces.reduce(
      (count, trace) =>
        count +
        trace.route.filter((segment) => segment.route_type === "via").length,
      0,
    ),
    totalTraceLength: getTraceLength(traces),
  }
}
