import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
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
import type { AnyCircuitElement, SourceTrace } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { getImx6ViaClearancePcbSvg } from "tests/fixtures/getImx6ViaClearancePcbSvg"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

function readCompressedFixture<T>(filename: string): T {
  const contents = readFileSync(
    new URL(`../fixtures/assets/${filename}`, import.meta.url),
  )
  return JSON.parse(gunzipSync(new Uint8Array(contents)).toString("utf8")) as T
}

function getFixedPcbGeometry(
  elements: AnyCircuitElement[],
): AnyCircuitElement[] {
  return elements.filter(
    (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
  )
}

test("keeps i.MX6 DDR vias clear of the full native board copper", async (): Promise<void> => {
  // The full TSX board's remaining-DDR input retains all native pads and
  // completed byte-bus copper. Peripheral and power routing remain unfinished.
  const srj = readCompressedFixture<SimpleRouteJson>(
    "imx6-full-board-via-phase.srj.json.gz",
  )
  const nativeBoard = readCompressedFixture<{
    circuitJson: AnyCircuitElement[]
  }>("imx6-pad-safe-via-repair.json.gz")
  const originalSrj = structuredClone(srj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  const routingStepsPerTick = 200
  while (!solver.solved && !solver.failed) {
    for (
      let step = 0;
      step < routingStepsPerTick && !solver.solved && !solver.failed;
      step += 1
    ) {
      solver.step()
    }
    // Yield temporary allocations as Core's local routing loop does.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
  expect(srj).toEqual(originalSrj)

  const circuitJson = replaceNativePcbTraces({
    circuitJson: nativeBoard.circuitJson,
    srj,
    traces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(getFixedPcbGeometry(circuitJson)).toEqual(
    getFixedPcbGeometry(nativeBoard.circuitJson),
  )
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(498)
  const routedNetIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  )
  expect(routedNetIds.size).toBe(53)
  const nativeNetTraces: SourceTrace[] = [...routedNetIds].map((netId) => {
    const members = circuitJson.filter(
      (element): element is SourceTrace =>
        element.type === "source_trace" &&
        element.connected_source_net_ids?.includes(netId) === true,
    )
    const sourceTrace = members[0]
    if (!sourceTrace) throw new Error(`Missing native terminals for ${netId}`)
    return {
      ...sourceTrace,
      source_trace_id: netId,
      connected_source_port_ids: [
        ...new Set(
          members.flatMap((member) => member.connected_source_port_ids),
        ),
      ],
    }
  })
  const routedSourcePortIds = new Set(
    nativeNetTraces.flatMap((trace) => trace.connected_source_port_ids),
  )
  const routedPcbPortIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_port" &&
      routedSourcePortIds.has(element.source_port_id)
        ? [element.pcb_port_id]
        : [],
    ),
  )
  const continuityCircuit = circuitJson.filter(
    (element) =>
      (element.type !== "pcb_smtpad" && element.type !== "pcb_plated_hole") ||
      (element.pcb_port_id !== undefined &&
        routedPcbPortIds.has(element.pcb_port_id)),
  )
  expect(
    checkTraceContinuity([...continuityCircuit, ...nativeNetTraces]),
  ).toEqual([])

  const clearance = srj.minTraceToPadEdgeClearance
  if (clearance === undefined)
    throw new Error("Missing native copper clearance")
  const clearanceOptions = { minClearance: clearance }
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
  expect(findings).toHaveLength(2)
  const originalError = checkViaTraceClearance(
    nativeBoard.circuitJson,
    clearanceOptions,
  )[0]
  const focusCenter = originalError?.center
  if (typeof focusCenter?.x !== "number" || typeof focusCenter.y !== "number") {
    throw new Error("Missing native i.MX6 clearance error position")
  }
  const view = {
    circuitJson,
    connectedNetCount: routedNetIds.size,
    errorCount: findings.length,
    focusCenter: { x: focusCenter.x, y: focusCenter.y },
  }
  await expect(getImx6ViaClearancePcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getImx6ViaClearancePcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "detail", scale: 1 })
})
