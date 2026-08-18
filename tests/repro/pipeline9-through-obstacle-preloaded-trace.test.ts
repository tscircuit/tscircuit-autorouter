import { expect, test } from "bun:test"
import { sample003 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 preserves a materialized through-obstacle fanout trace", () => {
  const inputSrj = structuredClone(sample003) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const pipeline9 = solver.autoroutingPipelineSolver?.autoroutingPipelineSolver
  if (!pipeline9?.srjWithPointPairs) {
    throw new Error("Expected Pipeline9 to reach joint DRC repair")
  }
  const routedBoard = solver.getOutput()
  const routedBoardTraces = routedBoard.traces ?? []
  expect(
    routedBoardTraces.some((trace) =>
      trace.route.some(
        (routePoint) => routePoint.route_type === "through_obstacle",
      ),
    ),
  ).toBe(true)

  const circuitJson = convertToCircuitJson(
    pipeline9.srjWithPointPairs,
    routedBoardTraces,
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
