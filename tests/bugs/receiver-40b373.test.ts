import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/receiver-40b373/receiver-40b373.json" with {
  type: "json",
}
import "../fixtures/svg-matcher"

test("receiver drill placement and neck widths", async (): Promise<void> => {
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
  const viaInPadErrors = checkViasInPads(circuitJson)
  expect(viaInPadErrors).toHaveLength(0)

  const escape = drcInput.routedTraces.find(
    (trace) =>
      trace.connectsTo?.includes("pcb_port_132") &&
      trace.connectsTo?.includes("pcb_port_82"),
  )
  expect(escape).toBeDefined()
  const wires = escape!.route
    .filter((point) => point.route_type === "wire")
    .filter((point) => point.layer === "top")
  expect(wires[0]!.width).toBeCloseTo(0.7500112, 6)
  expect(wires[1]!.y - wires[0]!.y).toBeCloseTo(0.3750056, 5)
  expect(wires[2]!.width).toBe(1)
  expect(wires[3]!.width).toBe(1)

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
