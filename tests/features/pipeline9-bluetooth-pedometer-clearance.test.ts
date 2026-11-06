import { expect, test } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/bluetooth-pedometer-clearance.srj.json"

test("Bluetooth pedometer reproduces nine missed 0.1 mm trace gaps with fixed terminals", (): void => {
  // Automatic-routing input exported from techmannih/Bluetooth-pedometer
  // ebe6cfad63786434183a4ec6709409ade261dfff, with manual copper removed.
  // Adds the requested traceClearance that core previously omitted from SRJ.
  const input = structuredClone(fixture) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const validation = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: 0.05,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  }
  const reported = evaluateRelaxedDrc(validation)
  const requestedTraceErrors = checkEachPcbTraceNonOverlapping(
    reported.circuitJson,
    { minClearance: 0.1 },
  )
  // The existing evaluator reports a pass under the pad rule, but the
  // explicitly requested trace rule exposes nine real copper-spacing errors.
  expect(reported.errors).toEqual([])
  expect(requestedTraceErrors).toHaveLength(9)
  const outputCoordinates = new Set(
    routedTraces.flatMap((trace) =>
      trace.route.flatMap((point) =>
        point.route_type === "wire" ? [JSON.stringify([point.x, point.y])] : [],
      ),
    ),
  )
  for (const connection of original.connections) {
    for (const point of connection.pointsToConnect) {
      expect(outputCoordinates.has(JSON.stringify([point.x, point.y]))).toBe(
        true,
      )
    }
  }
  expect(input).toEqual(original)
  const color = requestedTraceErrors.length === 0 ? "#166534" : "#b91c1c"
  const caption = `<g><rect x="12" y="62" width="540" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="90" font-family="Arial, sans-serif" font-size="18" fill="${color}">Bluetooth pedometer: 0.1 mm trace errors: ${requestedTraceErrors.length}</text></g>`
  expect(
    getBugReportSnapshotSvg(validation).replace("</svg>", `${caption}</svg>`),
  ).toMatchSvgSnapshot(import.meta.path)
})
