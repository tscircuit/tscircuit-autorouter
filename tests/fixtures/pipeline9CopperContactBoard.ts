import { createPipeline9CopperContactEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CopperContactEvaluator"
import type { Pipeline9CopperPair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

type TraceRoutePoint = SimplifiedPcbTrace["route"][number]

const createPad = (id: string, net: string, x: number, y: number): Obstacle => {
  return {
    type: "rect",
    layers: ["top"],
    center: { x, y },
    width: 0.4,
    height: 0.4,
    connectedTo: [net, id],
    obstacleId: id,
  }
}

/** Three two-pad nets: A on y=0, B on y=1, C on x=0. */
export const copperContactBoard: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  defaultObstacleMargin: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  obstacles: [
    createPad("padA1", "netA", -3, 0),
    createPad("padA2", "netA", 3, 0),
    createPad("padB1", "netB", -3, 1),
    createPad("padB2", "netB", 3, 1),
    createPad("padC1", "netC", 0, -2),
    createPad("padC2", "netC", 0, 2),
  ],
  connections: (
    [
      ["netA", "padA1", -3, 0, "padA2", 3, 0],
      ["netB", "padB1", -3, 1, "padB2", 3, 1],
      ["netC", "padC1", 0, -2, "padC2", 0, 2],
    ] as const
  ).map(([name, startPad, x1, y1, endPad, x2, y2]) => ({
    name,
    pointsToConnect: [
      { x: x1, y: y1, layer: "top", pcb_port_id: startPad },
      { x: x2, y: y2, layer: "top", pcb_port_id: endPad },
    ],
  })),
}

export const wire = (x: number, y: number, layer = "top"): TraceRoutePoint => {
  return { route_type: "wire", x, y, width: 0.15, layer }
}

export const via = (
  x: number,
  y: number,
  fromLayer: string,
  toLayer: string,
): TraceRoutePoint => {
  return {
    route_type: "via",
    x,
    y,
    from_layer: fromLayer,
    to_layer: toLayer,
    via_diameter: 0.3,
    via_hole_diameter: 0.15,
  }
}

export const trace = (
  id: string,
  net: string,
  route: TraceRoutePoint[],
): SimplifiedPcbTrace => {
  return { type: "pcb_trace", pcb_trace_id: id, connection_name: net, route }
}

const evaluateCopperContacts = createPipeline9CopperContactEvaluator({
  inputSrj: copperContactBoard,
  srjWithPointPairs: copperContactBoard,
})

/** The copper pairs in contact once these traces are routed on the board. */
export const findBoardCopperContacts = (
  traces: SimplifiedPcbTrace[],
): Pipeline9CopperPair[] => {
  return evaluateCopperContacts({
    routedTraces: traces,
    evaluatedTraceIds: new Set(traces.map((routed) => routed.pcb_trace_id)),
  })
}
