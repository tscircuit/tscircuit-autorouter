import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

type SolverLike = {
  netToPointPairsSolver?: {
    getNewSimpleRouteJson?: () => any
  }
  srjWithPointPairs?: any
  originalSrj?: SimpleRouteJson
  getOutputSimplifiedPcbTraces: () => any
  srj: {
    minTraceWidth?: number
  }
}

export const getCurrentCircuitJson = (
  solver: SolverLike,
  onError?: (message: string) => void,
) => {
  const srjWithPointPairs =
    solver.netToPointPairsSolver?.getNewSimpleRouteJson?.() ||
    solver.srjWithPointPairs

  if (!srjWithPointPairs) {
    onError?.(
      "No connection information available yet. Wait until point-pair generation completes.",
    )
    return null
  }

  const routes = solver.getOutputSimplifiedPcbTraces()
  if (!routes) {
    onError?.(
      "No routed traces available yet. Run routing first, then try again.",
    )
    return null
  }

  return convertToCircuitJson(srjWithPointPairs, routes, {
    minTraceWidth: solver.srj.minTraceWidth,
    originalSrj: solver.originalSrj,
  })
}
