import type { AnyCircuitElement } from "circuit-json"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import type { TraceWidthSolverInput } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type H616WidthFixture = {
  inputSrj: SimpleRouteJson
  widthInput: TraceWidthSolverInput
  nativeCircuit: AnyCircuitElement[]
  focus: {
    connectionName: HighDensityRoute["connectionName"]
    nativeNet: string
    pointIndex: number
    layer: number
    center: { x: number; y: number }
    requestedWidth: number
  }
}

export function getH616WidthCircuit({
  fixture,
  hdRoutes,
}: {
  fixture: H616WidthFixture
  hdRoutes: HighDensityRoute[]
}): AnyCircuitElement[] {
  const { inputSrj, nativeCircuit } = fixture
  const traces: SimplifiedPcbTrace[] = hdRoutes.map((route) => ({
    type: "pcb_trace",
    pcb_trace_id: route.connectionName,
    connection_name: route.rootConnectionName!,
    route: convertHdRouteToSimplifiedRoute(route, inputSrj.layerCount, {
      defaultViaHoleDiameter: inputSrj.minViaHoleDiameter,
    }),
  }))
  const owners = new Set(traces.map((trace) => trace.connection_name))
  const replacedIds = new Set(
    nativeCircuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id &&
      owners.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const circuit = nativeCircuit.filter((element) => {
    if (element.type === "pcb_trace") return !replacedIds.has(element.pcb_trace_id)
    if (element.type === "pcb_via") return !replacedIds.has(element.pcb_trace_id!)
    return true
  })
  const byId = new Map(traces.map((trace) => [trace.pcb_trace_id, trace]))
  for (const element of convertToCircuitJson(inputSrj, traces)) {
    if (element.type !== "pcb_trace" && element.type !== "pcb_via") continue
    if (element.type === "pcb_trace") {
      const trace = byId.get(element.pcb_trace_id)
      if (!trace) throw new Error("Missing native DDR trace owner")
      circuit.push({ ...element, source_trace_id: trace.connection_name })
    } else {
      circuit.push({ ...element, pcb_via_id: `width_${element.pcb_via_id}` })
    }
  }
  return circuit
}
