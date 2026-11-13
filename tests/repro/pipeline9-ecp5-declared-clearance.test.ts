import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkEachPcbTraceNonOverlapping,
  checkTracesAreContiguous,
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
type Ecp5DdrFixture = {
  circuitJson: AnyCircuitElement[]
  input: Omit<JointRepairInput, "srj" | "connMap" | "mutatedPreloadedTraceIds">
  netMap: ConnectivityMap["netMap"]
}
type SourcePortId = string
type PcbPortId = string

test("ECP5 DDR repair beside fixed data copper", async (): Promise<void> => {
  // Native 163-component, 170-net board. Captured at joint DDR repair in
  // tscircuit 0.0.3170, with both completed data bytes retained as fixed copper.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/ecp5-ddr-declared-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Ecp5DdrFixture
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
    circuit.filter((element) => element.type === "source_trace"),
  ).toHaveLength(170)
  expect(checkTracesAreContiguous(circuit)).toEqual([])
  const routedSourceTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" ? [element.source_trace_id] : [],
    ),
  )
  const routedSources = circuit.filter(
    (element) =>
      element.type === "source_trace" &&
      routedSourceTraceIds.has(element.source_trace_id),
  )
  expect(routedSources).toHaveLength(50)
  const pcbPorts = new Map<SourcePortId, PcbPortId>(
    circuit.flatMap((element) =>
      element.type === "pcb_port"
        ? [[element.source_port_id, element.pcb_port_id]]
        : [],
    ),
  )
  const connectivity = new PcbConnectivityMap(circuit)
  for (const source of routedSources) {
    if (source.type !== "source_trace") throw new Error("Expected DDR net")
    const portIds = source.connected_source_port_ids.map((sourcePortId) => {
      const pcbPortId = pcbPorts.get(sourcePortId)
      if (!pcbPortId) throw new Error(`Missing native port ${sourcePortId}`)
      return pcbPortId
    })
    expect(connectivity.connMap.areAllIdsConnected(portIds)).toBeTrue()
  }
  const focusedSourceTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "source_trace" &&
      ["RAM_D7", "RAM_CS#"].includes(element.display_name ?? "")
        ? [element.source_trace_id]
        : [],
    ),
  )
  expect(focusedSourceTraceIds.size).toBe(2)
  const contacts = checkEachPcbTraceNonOverlapping(circuit, {
    minClearance: srj.minTraceToPadEdgeClearance,
  }).filter((error) => error.message.includes("accidental contact"))
  expect(contacts.some((error) => error.message.includes("RAM_D7"))).toBeFalse()
  const originalContact = checkEachPcbTraceNonOverlapping(fixture.circuitJson, {
    minClearance: srj.minTraceToPadEdgeClearance,
  }).find((error) => error.message.includes("RAM_D7 overlaps"))
  if (!originalContact?.center) throw new Error("Missing native D7 contact")
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
  const focusedTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      focusedSourceTraceIds.has(element.source_trace_id)
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
        center: originalContact.center!,
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
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "d7-cs", scale: 1 })
})
