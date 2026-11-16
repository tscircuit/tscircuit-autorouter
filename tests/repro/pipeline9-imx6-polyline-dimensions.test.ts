import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbPort, PcbTrace, PcbVia } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { areNativePcbPortsConnected } from "tests/fixtures/areNativePcbPortsConnected"
import { getImx6PolylineCircuitSnapshots } from "tests/fixtures/getImx6PolylineCircuitSnapshots"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type Imx6CircuitFixture = {
  input: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
}

test("i.MX6 DDR polyline candidates use the requested copper dimensions", async (): Promise<void> => {
  // Retain all native components, pads and nets, including completed data-byte
  // copper. Replay the remaining DDR phase using the board's original rules.
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/assets/imx6-polyline-dimensions.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as Imx6CircuitFixture
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const circuit = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.input,
    traces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(
    circuit.filter((element) => element.type === "source_component"),
  ).toHaveLength(498)
  expect(
    circuit.filter((element) => element.type === "source_net"),
  ).toHaveLength(404)
  const routedNetIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" ? [element.source_trace_id!] : [],
    ),
  )
  expect(routedNetIds.size).toBe(53)
  const ports = new Map(
    circuit
      .filter((element): element is PcbPort => element.type === "pcb_port")
      .map((port) => [port.source_port_id, port]),
  )
  const vias = circuit.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  for (const netId of routedNetIds) {
    const sourcePortIds = new Set(
      circuit.flatMap((element) =>
        element.type === "source_trace" &&
        element.connected_source_net_ids?.includes(netId)
          ? element.connected_source_port_ids
          : [],
      ),
    )
    const pcbPortIds = circuit.flatMap((element) =>
      element.type === "pcb_port" && sourcePortIds.has(element.source_port_id)
        ? [element.pcb_port_id]
        : [],
    )
    expect(pcbPortIds.length).toBeGreaterThanOrEqual(2)
    const traces = circuit.filter(
      (element): element is PcbTrace =>
        element.type === "pcb_trace" && element.source_trace_id === netId,
    )
    expect(
      areNativePcbPortsConnected({
        sourcePortIds: [...sourcePortIds],
        traces,
        ports,
        vias,
      }),
    ).toBeTrue()
    expect(
      areNativePcbPortsConnected({
        sourcePortIds: [...sourcePortIds],
        traces: [],
        ports,
        vias: [],
      }),
    ).toBeFalse()
    expect(
      traces.every((trace) =>
        trace.route.every(
          (point) =>
            point.route_type !== "wire" ||
            point.width >= fixture.input.minTraceWidth,
        ),
      ),
    ).toBeTrue()
  }
  expect(checkTracesAreContiguous(circuit)).toEqual([])
  const clearance = { minClearance: fixture.input.minTraceToPadEdgeClearance }
  const findings = [
    ...checkEachPcbTraceNonOverlapping(circuit, clearance),
    ...checkPadTraceClearance(circuit, clearance),
    ...checkViaTraceClearance(circuit, clearance),
    ...checkViaPadClearance(circuit, clearance),
    ...checkDifferentNetViaSpacing(circuit),
    ...checkViasInPads(circuit),
  ]
  const snapshots = getImx6PolylineCircuitSnapshots({
    circuitJson: circuit,
    connectedNetCount: routedNetIds.size,
    drcErrorCount: findings.length,
  })
  await expect(snapshots.board).toMatchSvgSnapshot(import.meta.path)
  await expect(snapshots.clearance).toMatchSvgSnapshot(import.meta.path, {
    svgName: "clearance",
  })
})
