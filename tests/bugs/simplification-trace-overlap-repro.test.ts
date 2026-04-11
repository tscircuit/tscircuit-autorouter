import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import bugReport from "../../fixtures/bug-reports/simplification-trace-overlap-repro/simplification-trace-overlap-repro.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

const convertHdRoutesToPcbTraces = (
  srjWithPointPairs: SimpleRouteJson,
  hdRoutes: HighDensityRoute[],
): SimplifiedPcbTraces =>
  srjWithPointPairs.connections.flatMap((connection) => {
    const netConnectionName =
      connection.netConnectionName ??
      connection.rootConnectionName ??
      connection.name

    return hdRoutes
      .filter((route) => route.connectionName === connection.name)
      .map(
        (route, index): SimplifiedPcbTrace => ({
          type: "pcb_trace",
          pcb_trace_id: `${connection.name}_${index}`,
          connection_name: netConnectionName,
          route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
        }),
      )
  })

const getTraceOverlapErrors = (
  srjWithPointPairs: SimpleRouteJson,
  hdRoutes: HighDensityRoute[],
) =>
  getDrcErrors(
    convertToCircuitJson(
      srjWithPointPairs,
      convertHdRoutesToPcbTraces(srjWithPointPairs, hdRoutes),
      srj.minTraceWidth,
    ),
  ).locationAwareErrors.filter((error) =>
    error.message.includes("overlaps with trace"),
  )

const runSimplificationLoops = (
  pipeline: AutoroutingPipelineSolver,
  loops: number,
) => {
  const mergedHdRoutes = pipeline.highDensityStitchSolver?.mergedHdRoutes

  if (!mergedHdRoutes) {
    throw new Error("Pipeline did not produce merged high-density routes")
  }

  const simplifier = new TraceSimplificationSolver({
    hdRoutes: structuredClone(mergedHdRoutes),
    obstacles: structuredClone(srj.obstacles),
    connMap: pipeline.connMap,
    colorMap: pipeline.colorMap,
    outline: srj.outline,
    defaultViaDiameter: pipeline.viaDiameter,
    layerCount: srj.layerCount,
  })

  simplifier.MAX_SIMPLIFICATION_PIPELINE_LOOPS = loops
  simplifier.solve()

  expect(simplifier.failed).toBe(false)

  return simplifier.simplifiedHdRoutes
}

test(
  "simplification-trace-overlap-repro",
  () => {
    const pipeline = new AutoroutingPipelineSolver(structuredClone(srj))
    pipeline.solve()

    expect(pipeline.failed).toBe(false)

    const srjWithPointPairs = pipeline.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Pipeline did not produce point-pair SRJ")
    }

    const mergedHdRoutes = pipeline.highDensityStitchSolver?.mergedHdRoutes
    if (!mergedHdRoutes) {
      throw new Error("Pipeline did not produce merged high-density routes")
    }

    const preSimplificationErrors = getTraceOverlapErrors(
      srjWithPointPairs,
      mergedHdRoutes,
    )
    expect(preSimplificationErrors).toHaveLength(0)

    const pipelineOutputErrors = getTraceOverlapErrors(
      srjWithPointPairs,
      pipeline.traceSimplificationSolver?.simplifiedHdRoutes ?? mergedHdRoutes,
    )
    expect(pipelineOutputErrors).toHaveLength(0)

    const oneLoopRoutes = runSimplificationLoops(pipeline, 1)
    const oneLoopErrors = getTraceOverlapErrors(
      srjWithPointPairs,
      oneLoopRoutes,
    )
    expect(oneLoopErrors).toHaveLength(0)

    const twoLoopRoutes = runSimplificationLoops(pipeline, 2)
    const twoLoopErrors = getTraceOverlapErrors(
      srjWithPointPairs,
      twoLoopRoutes,
    )
    expect(twoLoopErrors).toHaveLength(0)
  },
  { timeout: 120_000 },
)
