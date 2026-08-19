import { expect, test } from "bun:test"
import { sample003 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 rejects a materialized through-obstacle fanout trace", () => {
  const inputSrj = structuredClone(sample003) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })
  let thrownError: Error | undefined

  try {
    solver.solve()
  } catch (error) {
    thrownError = error as Error
  }

  expect(thrownError?.message).toBe(
    'Pipeline9 cannot exactly repair through-obstacle preloaded trace "fanout:DDR3_a2_dram_dq13:source-1"',
  )
  expect(solver.failed).toBe(true)

  const pipeline9 = solver.autoroutingPipelineSolver?.autoroutingPipelineSolver
  if (!pipeline9?.srjWithPointPairs) {
    throw new Error("Expected Pipeline9 to reach joint DRC repair")
  }
  const failedBoardTraces = pipeline9.getUpdatedPreloadedTraces()
  expect(
    failedBoardTraces.some((trace) =>
      trace.route.some(
        (routePoint) => routePoint.route_type === "through_obstacle",
      ),
    ),
  ).toBe(true)

  const circuitJson = convertToCircuitJson(
    pipeline9.srjWithPointPairs,
    failedBoardTraces,
    {
      minTraceWidth: inputSrj.minTraceWidth,
      minViaDiameter: inputSrj.minViaDiameter,
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    },
  )
  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "#0f172a",
    matchBoardAspectRatio: true,
  })

  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
