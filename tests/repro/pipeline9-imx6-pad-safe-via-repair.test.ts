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
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimpleRouteJson } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getImx6ViaClearancePcbSvg } from "tests/fixtures/getImx6ViaClearancePcbSvg"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type Imx6ViaRepairFixture = {
  solverParams: Omit<
    ConstructorParameters<typeof GlobalDrcBranchPortfolioSolver>[0],
    "connMap"
  >
  originalSrj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
}

test("repairs the remaining i.MX6 DDR via clearance with native board geometry", async (): Promise<void> => {
  // Captured after the full TSX board's DDR repair; other signals are unfinished.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/imx6-pad-safe-via-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Imx6ViaRepairFixture
  const original = structuredClone(fixture)
  const srj = fixture.solverParams.srj
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new GlobalDrcBranchPortfolioSolver({
    ...fixture.solverParams,
    connMap,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
  expect(fixture).toEqual(original)
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srj.connections,
    originalConnections: fixture.originalSrj.connections,
    hdRoutes: solver.getOutput(),
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: fixture.solverParams.viaHoleDiameter!,
    connMap,
  })
  const circuitJson = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.originalSrj,
    traces,
  })
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
    expect(members.length).toBeGreaterThan(0)
    return {
      ...members[0]!,
      source_trace_id: netId,
      connected_source_port_ids: [
        ...new Set(members.flatMap((member) => member.connected_source_port_ids)),
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
  // Continuity needs the native pads of the routed DDR nets only.
  const continuityCircuit = circuitJson.filter(
    (element) =>
      (element.type !== "pcb_smtpad" &&
        element.type !== "pcb_plated_hole") ||
      (element.pcb_port_id !== undefined &&
        routedPcbPortIds.has(element.pcb_port_id)),
  )
  expect(checkTraceContinuity([...continuityCircuit, ...nativeNetTraces])).toEqual(
    [],
  )
  const clearanceOptions = {
    minClearance: fixture.originalSrj.minTraceToPadEdgeClearance!,
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
  expect(findings[0]?.type).toBe("pcb_via_trace_clearance_error")
  const originalFindings = checkViaTraceClearance(
    fixture.circuitJson,
    clearanceOptions,
  )
  const originalCenter = originalFindings[0]?.center
  if (
    typeof originalCenter?.x !== "number" ||
    typeof originalCenter.y !== "number"
  ) {
    throw new Error("Missing original i.MX6 clearance error position")
  }
  const focusCenter = { x: originalCenter.x, y: originalCenter.y }
  const view = {
    circuitJson,
    connectedNetCount: routedNetIds.size,
    errorCount: findings.length,
    focusCenter,
  }
  await expect(getImx6ViaClearancePcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getImx6ViaClearancePcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "clearance", scale: 1 })
})
