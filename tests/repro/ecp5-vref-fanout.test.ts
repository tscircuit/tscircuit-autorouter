import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
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
import type { AnyCircuitElement } from "circuit-json"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import nodeFixture from "tests/fixtures/ecp5-vref-fanout-node.json" with {
  type: "json",
}
import { getEcp5VrefFanoutPcbSvg } from "tests/fixtures/getEcp5VrefFanoutPcbSvg"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

test("reproduces the native C2/C3/R1/R2 VREF fanout rejection", async (): Promise<void> => {
  const node = nodeFixture as NodeWithPortPoints
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/ecp5-regional-boundary-copper.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  const original = structuredClone(node)
  const rootConnectionName = node.portPoints[0]!.rootConnectionName
  if (!rootConnectionName) {
    throw new Error("Missing the native VREF net")
  }
  const referenceNet = fixture.circuitJson.find(
    (element) =>
      element.type === "source_net" &&
      element.source_net_id === rootConnectionName,
  )!
  if (
    !referenceNet ||
    referenceNet.type !== "source_net" ||
    !referenceNet.trace_width
  ) {
    throw new Error("Missing the native VREF trace width")
  }
  const solver = new MultiHeadPolyLineIntraNodeSolver3({
    nodeWithPortPoints: node,
    viaDiameter: fixture.srj.minViaPadDiameter,
  })
  solver.traceWidth = referenceNet.trace_width
  solver.solve()

  expect(solver.error).toBe(
    "Not possible to solve problem with given SEGMENTS_PER_POLYLINE (3), atleast 6 vias are required",
  )
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.solvedRoutes).toHaveLength(0)
  expect(node).toEqual(original)
  const traces = solver.solvedRoutes.map(
    (route): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: route.connectionName,
      connection_name: rootConnectionName,
      route: convertHdRouteToSimplifiedRoute(route, fixture.srj.layerCount),
    }),
  )
  const circuitJson = replaceNativePcbTraces({ ...fixture, traces })
  const nativePortIds = new Set(
    node.portPoints.map((port) => port.pcb_port_id!),
  )
  expect(nativePortIds.size).toBe(4)
  const pcbMap = new PcbConnectivityMap(circuitJson)
  const traceIds = traces.map((trace) => trace.pcb_trace_id).sort()
  for (const portId of nativePortIds) {
    expect(
      pcbMap
        .getAllTracesConnectedToPort(portId)
        .map((trace) => trace.pcb_trace_id)
        .sort(),
    ).toEqual(traceIds)
  }
  expect(solver.solvedRoutes.flatMap((route) => route.vias)).toEqual([])
  expect(
    circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  ).toEqual(
    fixture.circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  )
  const clearanceOptions = {
    minClearance: fixture.srj.minTraceToPadEdgeClearance!,
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
  expect(findings).toEqual([])
  const view = {
    circuitJson,
    node,
    routedBranchCount: solver.solvedRoutes.length,
  }
  await expect(getEcp5VrefFanoutPcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getEcp5VrefFanoutPcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "focused", scale: 1 })
})
