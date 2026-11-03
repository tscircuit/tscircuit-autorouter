import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export const endcapClearance = 0.1

/** Board-world points in mm, +X right/+Y up, with one copper layer. */
export function getRetainedTraceEndcapInput(fixedWidth = 1): SimpleRouteJson {
  const terminals = [
    { x: -1, y: 0, net: "FIXED", port: "fixed_start", size: 0.1 },
    { x: 1, y: 0, net: "FIXED", port: "fixed_end", size: 0.1 },
    { x: 1.4, y: -2, net: "SIGNAL", port: "signal_start", size: 0.25 },
    { x: 1.4, y: 2, net: "SIGNAL", port: "signal_end", size: 0.25 },
  ]
  return {
    layerCount: 1,
    minTraceWidth: 0.1,
    defaultObstacleMargin: endcapClearance,
    minTraceToPadEdgeClearance: endcapClearance,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: terminals.map((terminal) => ({
      type: "rect",
      center: { x: terminal.x, y: terminal.y },
      width: terminal.size,
      height: terminal.size,
      layers: ["top"],
      connectedTo: [terminal.net, terminal.port],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad_${terminal.port}`,
        pcb_port_id: terminal.port,
      },
    })),
    connections: ["FIXED", "SIGNAL"].map((name) => ({
      name,
      ...(name === "FIXED" ? { nominalTraceWidth: fixedWidth } : {}),
      pointsToConnect: terminals
        .filter((terminal) => terminal.net === name)
        .map((terminal) => ({
          x: terminal.x,
          y: terminal.y,
          layer: "top",
          pcb_port_id: terminal.port,
        })),
    })),
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "FIXED",
        connectsTo: ["FIXED"],
        route: [
          { route_type: "wire", x: -1, y: 0, width: fixedWidth, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: fixedWidth, layer: "top" },
        ],
      },
    ],
  }
}

/** Physical edge gap to the retained wire, independent of obstacle proxies. */
export function getRetainedTraceEndcapGap({
  inputSrj,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
}): number {
  const [fixedStart, fixedEnd] = inputSrj.traces![0]!.route
  if (fixedStart!.route_type !== "wire" || fixedEnd!.route_type !== "wire") {
    throw new Error("Expected a retained wire segment")
  }
  let gap = Infinity
  for (const trace of routedTraces) {
    if (trace.connection_name !== "SIGNAL") continue
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]!
      const end = trace.route[index]!
      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      gap = Math.min(
        gap,
        minimumDistanceBetweenSegments(start, end, fixedStart!, fixedEnd!) -
          (fixedStart!.width + Math.max(start.width, end.width)) / 2,
      )
    }
  }
  if (!Number.isFinite(gap)) throw new Error("No routed signal copper")
  return gap
}
