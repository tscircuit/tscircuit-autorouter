import type { SimpleRouteJson } from "lib/types"

export function createPipeline9LengthMatchingPreloadedInput(
  preloadedY: number,
): SimpleRouteJson {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 14, minY: -4, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "a",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
      {
        name: "b",
        pointsToConnect: [
          { x: 0, y: 3, layer: "top" },
          { x: 12, y: 3, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "fixednet",
        connectsTo: ["fixed_start", "fixed_end"],
        route: [
          {
            route_type: "wire",
            x: 1,
            y: preloadedY,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 9,
            y: preloadedY,
            width: 0.15,
            layer: "top",
          },
        ],
      },
    ],
    buses: [{ busId: "bus", connectionNames: ["a", "b"], maxLengthSkew: 0.1 }],
  }
  for (const connection of srj.connections) {
    for (const [index, point] of connection.pointsToConnect.entries()) {
      point.pcb_port_id = `${connection.name}_${index}`
      srj.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [point.pcb_port_id],
        circuitJsonMetadata: {
          pcb_port_id: point.pcb_port_id,
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
        },
      })
    }
  }
  for (const [index, x] of [1, 9].entries()) {
    const pcbPortId = index === 0 ? "fixed_start" : "fixed_end"
    srj.obstacles.push({
      type: "rect",
      center: { x, y: preloadedY },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: [pcbPortId, "fixednet"],
      circuitJsonMetadata: {
        pcb_port_id: pcbPortId,
        pcb_smtpad_id: `pad_${pcbPortId}`,
      },
    })
  }
  return srj
}
