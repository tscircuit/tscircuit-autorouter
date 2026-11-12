import type { AnyCircuitElement, SourceTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

export type H616TerminalStitchFixture = {
  input: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  preloadedRoutes: PreloadedHighDensityRoute[]
  netMap: ConstructorParameters<typeof ConnectivityMap>[0]
}

type SourceTraceId = string
type PcbTraceId = string

export const getH616TerminalStitchCircuit = ({
  board,
  fixture,
  hdRoutes,
}: {
  board: { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  fixture: H616TerminalStitchFixture
  hdRoutes: HighDensityRoute[]
}): AnyCircuitElement[] => {
  const { srj, circuitJson } = board
  const connMap = new ConnectivityMap(fixture.netMap)
  const traces: SimplifiedPcbTrace[] = [
    ...fixture.preloadedRoutes.map(
      (route, index): SimplifiedPcbTrace => ({
        type: "pcb_trace",
        pcb_trace_id: `stitched_preloaded_${index}`,
        connection_name:
          srj.traces![route.preloadedTraceIndex]!.connection_name,
        route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, {
          defaultViaHoleDiameter: srj.minViaHoleDiameter,
        }),
      }),
    ),
    ...convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: fixture.input.connections,
      originalConnections: srj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(hdRoutes),
      layerCount: srj.layerCount,
      obstacles: srj.obstacles,
      defaultViaHoleDiameter: srj.minViaHoleDiameter!,
      connMap,
    }),
  ]
  const sourceByPcbTraceId = new Map<PcbTraceId, SourceTrace>()
  const replacedSourceTraceIds = new Set<SourceTraceId>()
  for (const trace of traces) {
    const owners = circuitJson.filter(
      (element): element is SourceTrace =>
        element.type === "source_trace" &&
        (element.source_trace_id === trace.connection_name ||
          element.connected_source_net_ids?.includes(trace.connection_name) ===
            true),
    )
    if (owners.length !== 1) {
      throw new Error(`Expected one native owner for ${trace.connection_name}`)
    }
    sourceByPcbTraceId.set(trace.pcb_trace_id, owners[0]!)
    replacedSourceTraceIds.add(owners[0]!.source_trace_id)
  }
  const replacedPcbTraceIds = new Set<PcbTraceId>(
    circuitJson
      .filter(
        (element) =>
          element.type === "pcb_trace" &&
          element.source_trace_id !== undefined &&
          replacedSourceTraceIds.has(element.source_trace_id),
      )
      .map((element) => {
        if (element.type !== "pcb_trace") throw new Error("Expected PCB trace")
        return element.pcb_trace_id
      }),
  )
  // The data-byte routes are fixed obstacles, not mutable SRJ traces. Keep
  // their native copper and vias alongside every original component and pad.
  const nativeCircuit = circuitJson.filter((element) => {
    if (element.type === "pcb_trace") {
      return !replacedPcbTraceIds.has(element.pcb_trace_id)
    }
    if (element.type === "pcb_via") {
      return !replacedPcbTraceIds.has(element.pcb_trace_id!)
    }
    return true
  })
  const converted = convertToCircuitJson(srj, traces)
  for (const element of converted) {
    if (element.type !== "pcb_trace" && element.type !== "pcb_via") continue
    const source = sourceByPcbTraceId.get(element.pcb_trace_id!)
    if (!source) throw new Error("Missing native copper owner")
    if (element.type === "pcb_trace") {
      nativeCircuit.push({
        ...element,
        source_trace_id: source.source_trace_id,
        subcircuit_id: source.subcircuit_id,
      })
    } else {
      nativeCircuit.push({
        ...element,
        pcb_via_id: `stitched_${element.pcb_via_id}`,
        subcircuit_id: source.subcircuit_id,
      })
    }
  }
  return nativeCircuit
}
