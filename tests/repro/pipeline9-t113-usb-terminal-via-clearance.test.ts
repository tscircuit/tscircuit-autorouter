import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import componentCircuitJson from "../../fixtures/bug-reports/t113-s3-usb-terminal-via-clearance/t113-s3-usb-component-circuit.json" with {
  type: "json",
}
import inputSrjJson from "../../fixtures/bug-reports/t113-s3-usb-terminal-via-clearance/t113-s3-usb-terminal-via-clearance.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

type SmtPad = Extract<CircuitJson[number], { type: "pcb_smtpad" }>
type RoutePoint = NonNullable<
  SimpleRouteJson["traces"]
>[number]["route"][number]
type RouteVia = Extract<RoutePoint, { route_type: "via" }>

const getViaPadGapMm = (via: RouteVia, pad: SmtPad): number => {
  if (via.via_diameter === undefined) throw new Error("Via has no diameter")
  if (pad.shape === "rect") {
    return (
      Math.hypot(
        Math.max(0, Math.abs(via.x - pad.x) - pad.width / 2),
        Math.max(0, Math.abs(via.y - pad.y) - pad.height / 2),
      ) -
      via.via_diameter / 2
    )
  }
  if (pad.shape !== "polygon") throw new Error("Unexpected terminal pad shape")
  const edgeDistanceMm = Math.min(
    ...pad.points.map((point, index) =>
      pointToSegmentDistance(
        via,
        point,
        pad.points[(index + 1) % pad.points.length]!,
      ),
    ),
  )
  return (
    (isPointInsidePolygon(via, pad.points) ? -edgeDistanceMm : edgeDistanceMm) -
    via.via_diameter / 2
  )
}

test("Pipeline9 keeps terminal vias clear on the real T113-S3 USB phase", () => {
  const inputSrj = structuredClone(inputSrjJson) as SimpleRouteJson
  const componentCircuit = componentCircuitJson as CircuitJson
  const componentNames = componentCircuit
    .filter((element) => element.type === "source_component")
    .map((component) => component.name)
  expect(componentNames).toEqual([
    "J_USB_C",
    "F_VBUS",
    "D_VBUS_TVS",
    "C_VBUS_BULK_A",
    "C_VBUS_BULK_B",
    "R_USB_CC1",
    "R_USB_CC2",
    "R_USB_DM_BRIDGE",
    "R_USB_DP_BRIDGE",
    "U_USB_ESD",
    "TP_USB_DP",
    "TP_USB_DM",
  ])
  expect(inputSrj).toMatchObject({
    layerCount: 10,
    minViaEdgeToPadEdgeClearance: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    allowBlindAndBuriedVias: false,
  })
  expect(inputSrj.obstacles).toHaveLength(42)
  expect(inputSrj.connections).toHaveLength(1)
  expect(inputSrj.traces).toHaveLength(2)
  expect(
    componentCircuit.find(
      (element) =>
        element.type === "source_trace" &&
        element.source_trace_id === "source_trace_2",
    ),
  ).toMatchObject({
    name: "USB_VBUS_A_IN",
    display_name: "J_USB_C.A4B9 to F_VBUS.pin1",
    min_trace_thickness: 0.8,
  })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 10,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const routedTraces = solver.getOutputSimpleRouteJson().traces!
  expect(routedTraces).toHaveLength(3)
  const vbusTrace = routedTraces.find(
    (trace) => trace.connection_name === "source_trace_2",
  )!
  const terminalVias = vbusTrace.route.filter(
    (point): point is RouteVia => point.route_type === "via",
  )
  expect(terminalVias).toHaveLength(2)

  const terminalPads = ["pcb_smtpad_11", "pcb_smtpad_13"].map((padId) => {
    const pad = componentCircuit.find(
      (element) =>
        element.type === "pcb_smtpad" && element.pcb_smtpad_id === padId,
    )
    if (pad?.type !== "pcb_smtpad") throw new Error(`Missing pad ${padId}`)
    return pad
  })
  for (const pad of terminalPads) {
    const gapMm = Math.min(
      ...terminalVias.map((via) => getViaPadGapMm(via, pad)),
    )
    expect(gapMm).toBeGreaterThanOrEqual(0.1)
    expect(gapMm).toBeLessThan(0.10001)
  }

  const drc = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  expect(drc.errors).toEqual([])

  const routedCircuit = convertToCircuitJson(inputSrj, routedTraces)
  const scopedBoard = createPcbBoardElement({ ...inputSrj, outline: undefined })
  const routedCopper = routedCircuit.filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    convertCircuitJsonToPcbSvg([
      scopedBoard,
      ...componentCircuit.filter((element) => element.type !== "pcb_board"),
      ...routedCopper,
    ]),
  ).toMatchSvgSnapshot(import.meta.path)
})
