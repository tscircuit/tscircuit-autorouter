import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

type FanoutPoint = readonly [
  x: number,
  y: number,
  layer: "top" | "bottom",
  pcbPortId: string,
]
type FanoutConnection = readonly [
  name: string,
  start: FanoutPoint,
  end: FanoutPoint,
]

// Reduced from the IcePi SBC's 32-route BGA-to-connector fanout bank. The
// coordinates, layers, port ids, pad sizes, and six-layer rules come from the
// production board input; unrelated local nets only preserve its >180-route
// scale boundary.
// biome-ignore format: Keep each physical route on one line for fixture review.
const ICEPI_FANOUT: readonly FanoutConnection[] = [
  ["source_trace_0", [16, 1.65, "top", "pcb_port_905"], [18.53, 13.82, "top", "pcb_port_1015"]],
  ["source_trace_1", [17.3, 4.9, "top", "pcb_port_938"], [19.33, 13.02, "top", "pcb_port_1020"]],
  ["source_trace_2", [16.65, 0.35, "top", "pcb_port_920"], [17.73, 13.82, "top", "pcb_port_1009"]],
  ["source_trace_3", [16, 2.3, "top", "pcb_port_906"], [23.33, 13.02, "top", "pcb_port_1050"]],
  ["source_trace_4", [17.3, 0.35, "top", "pcb_port_934"], [19.33, 13.82, "top", "pcb_port_1021"]],
  ["source_trace_5", [15.35, 2.95, "top", "pcb_port_896"], [20.93, 13.82, "top", "pcb_port_1033"]],
  ["source_trace_6", [16, 3.6, "top", "pcb_port_907"], [21.73, 17.02, "top", "pcb_port_1040"]],
  ["source_trace_7", [14.05, 4.25, "top", "pcb_port_861"], [19.33, 17.02, "top", "pcb_port_1022"]],
  ["source_trace_8", [13.4, 4.25, "top", "pcb_port_845"], [22.53, 17.02, "top", "pcb_port_1046"]],
  ["source_trace_9", [14.7, 3.6, "top", "pcb_port_877"], [20.93, 17.02, "top", "pcb_port_1034"]],
  ["source_trace_10", [16.65, -0.3, "top", "pcb_port_919"], [23.33, 13.82, "top", "pcb_port_1051"]],
  ["source_trace_11", [13.4, 2.95, "top", "pcb_port_844"], [23.33, 17.02, "top", "pcb_port_1052"]],
  ["source_trace_12", [14.7, 2.95, "top", "pcb_port_876"], [20.13, 17.02, "top", "pcb_port_1028"]],
  ["source_trace_13", [16.65, 4.25, "top", "pcb_port_923"], [21.73, 13.82, "top", "pcb_port_1039"]],
  ["source_trace_14", [16.65, 4.9, "top", "pcb_port_924"], [20.93, 13.02, "top", "pcb_port_1032"]],
  ["source_trace_15", [16.65, 5.55, "top", "pcb_port_925"], [21.73, 17.82, "top", "pcb_port_1041"]],
  ["source_trace_16", [17.95, 4.25, "top", "pcb_port_956"], [21.73, 13.02, "top", "pcb_port_1038"]],
  ["source_trace_17", [17.95, 4.9, "top", "pcb_port_957"], [22.53, 17.82, "top", "pcb_port_1047"]],
  ["source_trace_18", [16.65, 1.65, "top", "pcb_port_921"], [22.53, 13.02, "top", "pcb_port_1044"]],
  ["source_trace_19", [17.3, 3.6, "top", "pcb_port_937"], [23.33, 17.82, "top", "pcb_port_1053"]],
  ["source_trace_20", [17.95, 3.6, "top", "pcb_port_955"], [22.53, 13.82, "top", "pcb_port_1045"]],
  ["source_trace_21", [17.3, 2.95, "top", "pcb_port_936"], [20.13, 13.02, "top", "pcb_port_1026"]],
  ["source_trace_22", [15.35, 3.6, "top", "pcb_port_897"], [20.93, 17.82, "top", "pcb_port_1035"]],
  ["source_trace_23", [16.65, 2.95, "top", "pcb_port_922"], [20.13, 13.82, "top", "pcb_port_1027"]],
  ["source_trace_24", [18.6, 5.55, "top", "pcb_port_643"], [18.53, 18.62, "top", "pcb_port_1018"]],
  ["source_trace_25", [18.489376, 19.519376, "bottom", "pcb_port_601"], [18.53, 17.02, "top", "pcb_port_1016"]],
  ["source_trace_26", [18.53, 17.02, "top", "pcb_port_1016"], [18.6, 4.9, "top", "pcb_port_642"]],
  ["source_trace_27", [19.210624, 20.240624, "bottom", "pcb_port_600"], [17.73, 17.02, "top", "pcb_port_1010"]],
  ["source_trace_28", [17.73, 17.02, "top", "pcb_port_1010"], [18.6, 4.25, "top", "pcb_port_641"]],
  ["source_trace_29", [15.35, 4.9, "top", "pcb_port_898"], [14.53, 13.82, "top", "pcb_port_985"]],
  ["source_trace_30", [14.05, 4.9, "top", "pcb_port_862"], [15.33, 17.02, "top", "pcb_port_992"]],
  ["source_trace_31", [10.15, 5.55, "top", "pcb_port_760"], [12.93, 17.82, "top", "pcb_port_975"]],
]

const toRoutePoint = ([x, y, layer, pcbPortId]: FanoutPoint) => ({
  x,
  y,
  layer,
  pointId: pcbPortId,
  pcb_port_id: pcbPortId,
})

const createIcePiFanoutConnections = (): SimpleRouteConnection[] =>
  ICEPI_FANOUT.map(([name, start, end]) => ({
    name,
    source_trace_id: name,
    nominalTraceWidth: 0.1,
    pointsToConnect: [toRoutePoint(start), toRoutePoint(end)],
  }))

const createIcePiPadObstacles = (
  connections: readonly FanoutConnection[],
): Obstacle[] => {
  const padByPortId = new Map<
    string,
    {
      point: FanoutPoint
      connectionNames: string[]
    }
  >()

  for (const [connectionName, start, end] of connections) {
    for (const point of [start, end] as const) {
      const pcbPortId = point[3]
      const pad = padByPortId.get(pcbPortId) ?? {
        point,
        connectionNames: [],
      }
      pad.connectionNames.push(connectionName)
      padByPortId.set(pcbPortId, pad)
    }
  }

  return [...padByPortId].map(([pcbPortId, { point, connectionNames }]) => ({
    type: "rect",
    layers: [point[2]],
    center: { x: point[0], y: point[1] },
    width: point[2] === "bottom" ? 0.54 : point[1] > 10 ? 0.36 : 0.24,
    height: point[2] === "bottom" ? 0.64 : point[1] > 10 ? 0.36 : 0.24,
    connectedTo: [pcbPortId, ...connectionNames],
  }))
}

export const getIcePiSixLayerFanoutRepro = (): SimpleRouteJson => {
  const fanoutConnections = createIcePiFanoutConnections()
  const fanoutQueue = [...fanoutConnections]
  const sampledConnectionIndexes = new Set(
    Array.from({ length: 32 }, (_, sampleIndex) =>
      Math.round((sampleIndex * 180) / 31),
    ),
  )
  let localConnectionIndex = 0
  const connections: SimpleRouteConnection[] = Array.from(
    { length: 181 },
    (_, connectionIndex) => {
      if (sampledConnectionIndexes.has(connectionIndex)) {
        return fanoutQueue.shift()!
      }

      const column = localConnectionIndex % 25
      const row = Math.floor(localConnectionIndex / 25)
      const x = -40 + column * 0.64
      const y = -27 + row * 0.55
      const connection: SimpleRouteConnection = {
        name: `local_board_net_${localConnectionIndex}`,
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          { x, y, layer: "top" },
          { x: x + 0.24, y, layer: "top" },
        ],
      }
      localConnectionIndex++
      return connection
    },
  )

  return {
    bounds: { minX: -43.5, maxX: 43.5, minY: -29, maxY: 29 },
    layerCount: 6,
    minTraceWidth: 0.1,
    nominalTraceWidth: 0.1,
    minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: createIcePiPadObstacles(ICEPI_FANOUT),
    connections,
  }
}
