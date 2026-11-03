import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/bluetooth-pedometer-clearance.srj.json"

test("Bluetooth pedometer honors 0.1 mm trace gaps and 0.05 mm pad gaps with fixed terminals", (): void => {
  // Automatic-routing input exported from techmannih/Bluetooth-pedometer
  // ebe6cfad63786434183a4ec6709409ade261dfff, with manual copper removed.
  // Adds the requested traceClearance that core previously omitted from SRJ.
  const input = structuredClone(fixture) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1, cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const validation = {
    inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.05, differentNetTraceClearance: 0.1,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance },
  }
  expect(evaluateRelaxedDrc(validation).errors).toEqual([])
  const outputCoordinates = new Set(routedTraces.flatMap((trace) => trace.route.flatMap((point) =>
    point.route_type === "wire" ? [JSON.stringify([point.x, point.y])] : [],
  )))
  for (const connection of original.connections) {
    for (const point of connection.pointsToConnect) {
      expect(outputCoordinates.has(JSON.stringify([point.x, point.y]))).toBe(true)
    }
  }
  expect(input).toEqual(original)
  expect(getBugReportSnapshotSvg(validation)).toMatchSvgSnapshot(import.meta.path)
})
