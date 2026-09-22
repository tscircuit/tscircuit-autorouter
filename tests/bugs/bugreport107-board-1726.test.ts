import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkSourceTracesHavePcbTraces,
} from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("Pipeline9 completely routes bugreport107-board-1726", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "unrouted" },
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

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
  }
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  // Capture the routed board even when the final DRC assertion fails.
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    snapshotPath,
    { svgName: "routed" },
  )
  const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
  // Continuity checks inspect existing copper, so also check entirely missing
  // source traces and ports before accepting the final board.
  expect(checkSourceTracesHavePcbTraces(circuitJson)).toEqual([])
  expect(
    checkEachPcbPortConnectedToPcbTraces(structuredClone(circuitJson)),
  ).toEqual([])
  expect(errors).toEqual([])
}, 900_000)
