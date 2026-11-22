import type { BgaEscapeBoard } from "./getBgaEscapeRoutingInput"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"

export function getBgaEscapeHdRoutes({
  inputSrj,
  pointPairs,
  traces,
}: Pick<BgaEscapeBoard, "inputSrj" | "pointPairs"> & {
  traces: SimplifiedPcbTrace[]
}): HighDensityIntraNodeRoute[] | undefined {
  const { padDiameter } = getViaDimensions(inputSrj)
  const pointPairByName = new Map(pointPairs.map((pair) => [pair.name, pair]))
  const evaluateCopper = createPipeline9AutoroutingDrcEvaluator({
    inputSrj,
    srjWithPointPairs: { ...inputSrj, connections: pointPairs },
    includeBoardClearance: true,
    // A manufacturing corridor can have less clearance to spare than the
    // display checker's rounding tolerance. Test the physical copper edges.
    clearanceTolerance: 1e-9,
    drcOptions: {
      traceClearance: inputSrj.minTraceToPadEdgeClearance,
      viaToPadClearance: inputSrj.minViaEdgeToPadEdgeClearance,
      viaClearance: inputSrj.minViaHoleEdgeToViaHoleEdgeClearance,
      holeClearance: inputSrj.minTraceToHoleEdgeClearance,
    },
  })
  if (evaluateCopper(traces).errors.length > 0) return

  const routes = traces.map((trace): HighDensityIntraNodeRoute => {
    const pair = pointPairByName.get(trace.connection_name)
    if (!pair)
      throw new Error(`Unexpected BGA point pair "${trace.connection_name}"`)
    pointPairByName.delete(trace.connection_name)
    const wires = trace.route.filter((point) => point.route_type === "wire")
    const vias = trace.route.filter((point) => point.route_type === "via")
    const start = wires[0]
    const end = wires.at(-1)
    const ports = new Set(
      pair.pointsToConnect.map((point) => point.pcb_port_id),
    )
    if (
      !start?.start_pcb_port_id ||
      !end?.end_pcb_port_id ||
      !ports.delete(start.start_pcb_port_id) ||
      !ports.delete(end.end_pcb_port_id) ||
      ports.size
    ) {
      throw new Error(
        `BGA route did not reach both requested ports for "${pair.name}"`,
      )
    }
    return {
      connectionName: pair.name,
      rootConnectionName: pair.__rootConnectionNames?.[0] ?? pair.name,
      startPcbPortId: start.start_pcb_port_id,
      endPcbPortId: end.end_pcb_port_id,
      traceThickness: start.width,
      viaDiameter: padDiameter,
      route: wires.map((point) => ({
        x: point.x,
        y: point.y,
        z: mapLayerNameToZ(point.layer, inputSrj.layerCount),
        pcb_port_id: point.start_pcb_port_id ?? point.end_pcb_port_id,
      })),
      vias: vias.map(({ x, y }) => ({ x, y })),
    }
  })
  if (pointPairByName.size)
    throw new Error("BGA routing omitted a requested point pair")
  return routes
}
