import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { getColorMap } from "lib/solvers/colors"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import input from "./allwinner-trace-simplification-input.json" with {
  type: "json",
}

type TraceSimplificationInput = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  defaultViaDiameter: number
}

const traceSimplificationInput = input as unknown as TraceSimplificationInput

export const createAllwinnerTraceSimplificationSolver =
  (): TraceSimplificationSolver => {
    const srj = structuredClone(traceSimplificationInput.srj)
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)

    return new TraceSimplificationSolver({
      hdRoutes: structuredClone(traceSimplificationInput.hdRoutes),
      obstacles: srj.obstacles,
      connMap,
      colorMap: getColorMap(srj, connMap),
      outline: srj.outline,
      defaultViaDiameter: traceSimplificationInput.defaultViaDiameter,
      layerCount: srj.layerCount,
      minTraceToPadEdgeClearance: srj.minTraceToPadEdgeClearance,
      minBoardEdgeClearance: srj.minBoardEdgeClearance,
      enableCrossingViaReduction: true,
    })
  }
