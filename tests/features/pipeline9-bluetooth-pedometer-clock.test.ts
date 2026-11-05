import { expect, test } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/bluetooth-pedometer-clock.srj.json"

test("real Bluetooth pedometer honors the X48_N zero-via and 6 mm limits", (): void => {
  // https://tscircuit.com/techmannih/Bluetooth-pedometer @ ebe6cfad63786434183a4ec6709409ade261dfff.
  // Complete board geometry, all 48 nets and 213 terminals; manual copper removed.
  // Restore only X48_N's lost rule to isolate the clock-routing defect.
  const input = structuredClone(fixture) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const clockTraces = traces.filter(
    (trace) =>
      trace.connection_name === "source_net_29" ||
      trace.connection_name.startsWith("source_net_29_"),
  )
  const vias = clockTraces
    .flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via").length
  let length = 0
  for (const trace of clockTraces) {
    for (let index = 1; index < trace.route.length; index++) {
      const a = trace.route[index - 1]!
      const b = trace.route[index]!
      if (
        a.route_type === "wire" &&
        b.route_type === "wire" &&
        a.layer === b.layer
      )
        length += Math.hypot(a.x - b.x, a.y - b.y)
    }
  }
  expect(vias).toBe(0)
  expect(length).toBeGreaterThan(0)
  expect(length).toBeLessThanOrEqual(6)
  const outputCoordinates = new Set(
    traces.flatMap((trace) =>
      trace.route.flatMap((point) =>
        point.route_type === "wire" ? [JSON.stringify([point.x, point.y])] : [],
      ),
    ),
  )
  for (const connection of original.connections) {
    for (const point of connection.pointsToConnect)
      expect(outputCoordinates.has(JSON.stringify([point.x, point.y]))).toBe(
        true,
      )
  }
  expect(input).toEqual(original)
  const validation = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
    drcOptions: { traceClearance: 0.05 },
  }
  const reported = evaluateRelaxedDrc(validation)
  expect(reported.errors).toEqual([])
  // Independently audit the board's requested 0.1 mm rule. Its export/enforcement
  // bug belongs to the separate clearance PRs; this clock stack uses main only.
  const requestedTraceErrors = checkEachPcbTraceNonOverlapping(
    reported.circuitJson,
    { minClearance: 0.1 },
  )
  const color = vias === 0 && length <= 6 ? "#166534" : "#b91c1c"
  const caption = `<g><rect x="12" y="62" width="600" height="72" rx="6" fill="white" stroke="${color}"/><text x="24" y="90" font-family="Arial, sans-serif" font-size="18" fill="${color}">X48_N: ${vias} vias / ${length.toFixed(2)} mm; allowed 0 vias / 6 mm</text><text x="24" y="114" font-family="Arial, sans-serif" font-size="14" fill="#475569">0.1 mm trace-rule errors (separate issue): ${requestedTraceErrors.length}</text></g>`
  expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
      drcOptions: { traceClearance: 0.05 },
    }).replace("</svg>", `${caption}</svg>`),
  ).toMatchSvgSnapshot(import.meta.path)
})
