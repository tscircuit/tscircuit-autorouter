import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver } from "lib"
import { getPipeline9PhysicalViaCount } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalViaCount"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/receiver-40b373/receiver-40b373.json" with {
  type: "json",
}
import "../fixtures/svg-matcher"

test("receiver bug report via-in-pad regression", async (): Promise<void> => {
  const srj: SimpleRouteJson = bugReport.simple_route_json
  expect(srj.connections).toHaveLength(44)
  expect(srj.obstacles).toHaveLength(202)
  expect(srj.allowViaInPad).toBe(false)
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
  expect(errors).toHaveLength(0)
  const viaCount = drcInput.routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  expect(viaCount).toBeLessThanOrEqual(113)
  expect(
    getPipeline9PhysicalViaCount({ traces: drcInput.routedTraces }),
  ).toBeLessThanOrEqual(111)
  const connectorRowMaxY = -20
  const connectorVias = drcInput.routedTraces.map((trace) => ({
    ...trace,
    route: trace.route.filter(
      (point) => point.route_type === "via" && point.y < connectorRowMaxY,
    ),
  }))
  expect(getPipeline9PhysicalViaCount({ traces: connectorVias })).toBe(0)
  const strictDrc = evaluateRelaxedDrc({
    ...drcInput,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: srj.minTraceToPadEdgeClearance,
      viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  expect(strictDrc.errors).toHaveLength(0)
  const viaInPadErrors = checkViasInPads(circuitJson)
  expect(viaInPadErrors).toHaveLength(0)

  let color = "#166534"
  if (viaInPadErrors.length > 0) color = "#b91c1c"
  const messages = viaInPadErrors
    .map((error, index): string => {
      const text = error.message
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
      return `<text x="24" y="${82 + index * 20}" font-family="Arial, sans-serif" font-size="11" fill="${color}">${text}</text>`
    })
    .join("")
  const overlay = `<g data-testid="native-via-in-pad-errors"><rect x="12" y="12" width="616" height="140" rx="6" fill="white" stroke="${color}"/><text x="24" y="36" font-family="Arial, sans-serif" font-size="20" fill="${color}">Receiver PCB: native drill/land overlaps: ${viaInPadErrors.length}</text><text x="24" y="58" font-family="Arial, sans-serif" font-size="13">allowViaInPad: false | drill ${srj.minViaHoleDiameter} mm | via annulus ${srj.minViaPadDiameter} mm</text>${messages}<text x="24" y="144" font-family="Arial, sans-serif" font-size="11">Same-net copper contact does not authorize drilling into a solder land.</text></g>`
  const boardSvg = getBugReportSnapshotSvg(drcInput).replace(
    "<svg ",
    '<svg y="160" ',
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800"><rect width="100%" height="100%" fill="white"/>${overlay}${boardSvg}</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
