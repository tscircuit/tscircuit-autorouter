import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkSourceTracesHavePcbTraces,
} from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("Pipeline9 completely routes bugreport107-board-1726", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()

  const pointPairs = solver.netToPointPairsSolver!.newConnections
  expect(pointPairs.length).toBeGreaterThan(0)
  const routedPairNames = new Set(
    solver
      ._getOutputHdRoutes()
      .filter((route) => route.route.length >= 2)
      .map((route) => route.connectionName),
  )
  expect(
    pointPairs
      .filter((connection) => !routedPairNames.has(connection.name))
      .map((connection) => connection.name),
  ).toEqual([])

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
  })
  // Continuity checks inspect existing copper, so also check entirely missing
  // source traces and ports before accepting the final board.
  expect(checkSourceTracesHavePcbTraces(circuitJson)).toEqual([])
  expect(
    checkEachPcbPortConnectedToPcbTraces(structuredClone(circuitJson)),
  ).toEqual([])
  expect(errors).toEqual([])
})
