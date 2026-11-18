import { expect, test } from "bun:test"
import {
  checkDanglingTraces,
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
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getH616PowerRoutingPcbSvg } from "tests/fixtures/getH616PowerRoutingPcbSvg"
import { getNativeRoutedCircuitContinuityErrors } from "tests/fixtures/getNativeRoutedCircuitContinuityErrors"
import { loadH616PowerRoutingFixture } from "tests/fixtures/loadH616PowerRoutingFixture"

test("captures H616 power routing beside completed signal copper", async (): Promise<void> => {
  const fixture = loadH616PowerRoutingFixture()
  const originalFixture = structuredClone(fixture)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.inputSrj,
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(fixture).toEqual(originalFixture)
  const circuitJson = fixture.circuitJson
  expect(getNativeRoutedCircuitContinuityErrors(circuitJson)).toEqual([])
  const connectedNetCount = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  ).size
  expect(connectedNetCount).toBe(109)
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
  ).toHaveLength(125)
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
    ...checkDanglingTraces(circuitJson),
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkViasOffBoard(circuitJson),
    ...checkViasInPads(circuitJson),
  ]
  expect(findings).toHaveLength(0)
  const view = {
    circuitJson,
    connectedNetCount,
    requestedNetCount: new Set([
      ...fixture.circuitJson.flatMap((element) =>
        element.type === "pcb_trace" && element.source_trace_id
          ? [element.source_trace_id]
          : [],
      ),
      ...fixture.inputSrj.connections.map((connection) => connection.name),
    ]).size,
    errorCount: findings.length,
    focusCenter: fixture.sameNetBranchNode.center,
  }
  await expect(getH616PowerRoutingPcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getH616PowerRoutingPcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "ground", scale: 1 })
})
