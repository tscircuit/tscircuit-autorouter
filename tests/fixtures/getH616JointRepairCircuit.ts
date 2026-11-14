import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import type { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

type JointRepairInput = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]
type PcbTraceId = SimplifiedPcbTrace["pcb_trace_id"]

export type H616JointRepairFixture = {
  jointRepairInput: Omit<
    JointRepairInput,
    "connMap" | "mutatedPreloadedTraceIds"
  > & {
    mutatedPreloadedTraceIds: PcbTraceId[]
  }
  netMap: ConnectivityMap["netMap"]
  circuitJson: AnyCircuitElement[]
}

/**
 * Native right-handed PCB points: millimeters, X right/Y up/Z above.
 * Coordinates are passed through without a transform.
 */
export function getH616JointRepairCircuit({
  fixture,
  solver,
}: {
  fixture: H616JointRepairFixture
  solver: Pipeline9JointDrcRepairSolver
}): AnyCircuitElement[] {
  const input = solver.params
  const traces = [
    ...solver.getUpdatedPreloadedTraces(),
    ...convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: input.newConnections,
      originalConnections: input.originalSrj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(solver.getOutput()),
      layerCount: input.layerCount,
      obstacles: input.obstacles,
      defaultViaHoleDiameter: input.defaultViaHoleDiameter,
      connMap: input.connMap,
    }),
  ]
  const replacedCopperOwners = new Set(
    traces.map((trace) => trace.connection_name),
  )
  const replacedPcbTraceIds = new Set<PcbTraceId>(
    fixture.circuitJson.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id &&
      replacedCopperOwners.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const circuitJson = fixture.circuitJson.filter((element) => {
    if (element.type === "pcb_trace") {
      return !replacedPcbTraceIds.has(element.pcb_trace_id)
    }
    if (element.type === "pcb_via" && element.pcb_trace_id) {
      return !replacedPcbTraceIds.has(element.pcb_trace_id)
    }
    return true
  })
  const traceByPcbTraceId = new Map<PcbTraceId, SimplifiedPcbTrace>(
    traces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  for (const element of convertToCircuitJson(input.originalSrj, traces)) {
    if (element.type === "pcb_trace") {
      const trace = traceByPcbTraceId.get(element.pcb_trace_id)
      if (!trace) throw new Error("Missing native owner for joint repair trace")
      circuitJson.push({ ...element, source_trace_id: trace.connection_name })
    } else if (element.type === "pcb_via") {
      circuitJson.push({
        ...element,
        pcb_via_id: `joint_repair_${element.pcb_via_id}`,
      })
    }
  }
  return circuitJson
}
