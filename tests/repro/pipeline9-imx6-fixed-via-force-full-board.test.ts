import { expect, test } from "bun:test"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
  checkViasOffBoard,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"
import { getImx6ViaClearancePcbSvg } from "tests/fixtures/getImx6ViaClearancePcbSvg"
import { getNativeRoutedCircuitContinuityErrors } from "tests/fixtures/getNativeRoutedCircuitContinuityErrors"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type Imx6FixedViaForceFixture = {
  inputSrj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
}

test("routes i.MX6 DDR controls beside fixed data-byte vias", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/imx6-fixed-via-force-full-board.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Imx6FixedViaForceFixture
  const originalFixture = structuredClone(fixture)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.inputSrj,
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(fixture).toEqual(originalFixture)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: fixture.inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    drcOptions: {
      traceClearance: fixture.inputSrj.minTraceToPadEdgeClearance,
      viaToPadClearance: fixture.inputSrj.minViaEdgeToPadEdgeClearance,
    },
  })
  expect(evaluate(traces).errors).toHaveLength(1)
  const circuitJson = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.inputSrj,
    traces,
  })
  expect(getNativeRoutedCircuitContinuityErrors(circuitJson)).toEqual([])
  const connectedNetCount = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  ).size
  expect(connectedNetCount).toBe(53)
  const nativeGeometry = circuitJson.filter(
    (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
  )
  expect(nativeGeometry).toEqual(
    fixture.circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  )
  expect(
    nativeGeometry.filter((element) => element.type === "source_component"),
  ).toHaveLength(498)
  const clearanceOptions = {
    minClearance: fixture.inputSrj.minTraceToPadEdgeClearance!,
  }
  const findings = [
    ...checkEachPcbTraceNonOverlapping(circuitJson, clearanceOptions),
    ...checkPadTraceClearance(circuitJson, clearanceOptions),
    ...checkViaTraceClearance(circuitJson, clearanceOptions),
    ...checkViaPadClearance(circuitJson, clearanceOptions),
    ...checkDifferentNetViaSpacing(circuitJson),
    ...checkHoleTraceClearance(circuitJson, clearanceOptions),
    ...checkTracesAreContiguous(circuitJson),
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkViasOffBoard(circuitJson),
    ...checkViasInPads(circuitJson),
  ]
  expect(findings).toHaveLength(1)
  const originalViaError = checkDifferentNetViaSpacing(fixture.circuitJson)[0]
  const originalCenter = originalViaError?.pcb_center
  if (
    typeof originalCenter?.x !== "number" ||
    typeof originalCenter.y !== "number"
  ) {
    throw new Error("Missing native i.MX6 via conflict")
  }
  const focusCenter = { x: originalCenter.x, y: originalCenter.y }
  const view = {
    circuitJson,
    connectedNetCount,
    errorCount: findings.length,
    focusCenter,
    showAllLayers: true,
  }
  await expect(getImx6ViaClearancePcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getImx6ViaClearancePcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "clearance", scale: 1 })
})
