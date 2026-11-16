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
import type { AnyCircuitElement } from "circuit-json"
import {
  ConnectivityMap,
  PcbConnectivityMap,
} from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type JointRepairInput = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]
type Ecp5CircuitFixture = {
  circuitJson: AnyCircuitElement[]
  input: Omit<JointRepairInput, "srj" | "connMap" | "mutatedPreloadedTraceIds">
  netMap: ConnectivityMap["netMap"]
}

test("repairs ECP5 DDR copper using the native clearance rules", async (): Promise<void> => {
  // The complete native PCB is retained. Replay the remaining DDR repair after
  // both data bytes, using its 0.089 mm copper rules and fixed earlier traces.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/ecp5-fixed-copper-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Ecp5CircuitFixture
  const connMap = new ConnectivityMap(fixture.netMap)
  const solver = new Pipeline9JointDrcRepairSolver({
    ...fixture.input,
    srj: fixture.input.srjWithPointPairs,
    connMap,
    mutatedPreloadedTraceIds: new Set(),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const srj = fixture.input.originalSrj
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: fixture.input.newConnections,
    originalConnections: srj.connections,
    hdRoutes: solver.getOutput(),
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    connMap,
  })
  const circuit = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj,
    traces,
  })
  expect(
    circuit.filter((element) => element.type === "source_component"),
  ).toHaveLength(163)
  expect(
    circuit.filter((element) => element.type === "source_net"),
  ).toHaveLength(152)
  expect(
    circuit.filter((element) => element.type === "source_trace"),
  ).toHaveLength(760)
  const routedNetIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" ? [element.source_trace_id] : [],
    ),
  )
  expect(routedNetIds.size).toBe(50)
  const connectivity = new PcbConnectivityMap(circuit)
  for (const netId of routedNetIds) {
    const sourcePortIds = new Set(
      circuit.flatMap((element) =>
        element.type === "source_trace" &&
        element.connected_source_net_ids?.includes(netId!)
          ? element.connected_source_port_ids
          : [],
      ),
    )
    const pcbPortIds = circuit.flatMap((element) =>
      element.type === "pcb_port" &&
      sourcePortIds.has(element.source_port_id)
        ? [element.pcb_port_id]
        : [],
    )
    expect(pcbPortIds.length).toBeGreaterThanOrEqual(2)
    expect(connectivity.connMap.areAllIdsConnected(pcbPortIds)).toBeTrue()
  }
  expect(checkTracesAreContiguous(circuit)).toEqual([])
  const clearanceOptions = {
    minClearance: srj.minTraceToPadEdgeClearance,
  }
  const findings = [
    ...checkEachPcbTraceNonOverlapping(circuit, clearanceOptions),
    ...checkPadTraceClearance(circuit, clearanceOptions),
    ...checkViaTraceClearance(circuit, clearanceOptions),
    ...checkViaPadClearance(circuit, clearanceOptions),
    ...checkDifferentNetViaSpacing(circuit),
    ...checkViasInPads(circuit),
  ]
  expect(findings).toHaveLength(34)
  const renderOptions = {
    backgroundColor: "white",
    colorOverrides: {
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
        inner3: "#c026d3",
        inner4: "#0891b2",
      },
      boardOutline: "#475569",
      drill: "#ffffff",
      silkscreen: { top: "#334155", bottom: "#334155" },
    },
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  }
  await expect(
    convertCircuitJsonToPcbSvg(circuit, {
      ...renderOptions,
      width: 1400,
      height: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  // Keep native pads and the two interacting nets in the focused PCB view.
  const focusedNetIds = new Set(["source_net_41", "source_net_102"])
  const focusedTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      focusedNetIds.has(element.source_trace_id!)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const focusedCircuit = circuit
    .filter((element) => {
      if (element.type === "pcb_trace") {
        return focusedTraceIds.has(element.pcb_trace_id)
      }
      if (element.type === "pcb_via") {
        return focusedTraceIds.has(element.pcb_trace_id!)
      }
      return true
    })
    .map((element): AnyCircuitElement => {
      if (element.type !== "pcb_board") return element
      return {
        ...element,
        center: { x: 5.65, y: -1.5 },
        width: 2,
        height: 2,
        outline: undefined,
      }
    })
  await expect(
    convertCircuitJsonToPcbSvg(focusedCircuit, {
      ...renderOptions,
      width: 900,
      height: 900,
      drawPaddingOutsideBoard: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "clearance", scale: 1 })
})
