import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

type FanoutPoint = readonly [x: number, y: number, pcbPortId: string]
type FanoutConnection = readonly [
  name: string,
  start: FanoutPoint,
  end: FanoutPoint,
]

// This is the minimal pair from the IcePi SBC fanout that shares a generated
// gateway. Coordinates, port ids, and pad sizes come from the six-layer board.
const ICEPI_FANOUT: readonly FanoutConnection[] = [
  [
    "source_trace_2",
    [16.65, 0.35, "pcb_port_920"],
    [17.73, 13.82, "pcb_port_1009"],
  ],
  [
    "source_trace_3",
    [16, 2.3, "pcb_port_906"],
    [23.33, 13.02, "pcb_port_1050"],
  ],
]

const toRoutePoint = ([x, y, pcbPortId]: FanoutPoint) => ({
  x,
  y,
  layer: "top" as const,
  pointId: pcbPortId,
  pcb_port_id: pcbPortId,
})

const createIcePiFanoutConnections = (): SimpleRouteConnection[] =>
  ICEPI_FANOUT.map(([name, start, end]) => ({
    name,
    source_trace_id: name,
    pointsToConnect: [toRoutePoint(start), toRoutePoint(end)],
  }))

const createIcePiPadObstacles = (): Obstacle[] =>
  ICEPI_FANOUT.flatMap(([connectionName, start, end]) =>
    [start, end].map((point) => ({
      type: "rect" as const,
      layers: ["top"],
      center: { x: point[0], y: point[1] },
      width: point[1] > 10 ? 0.36 : 0.24,
      height: point[1] > 10 ? 0.36 : 0.24,
      connectedTo: [point[2], connectionName],
    })),
  )

export const getIcePiSixLayerFanoutRepro = (): SimpleRouteJson => {
  const fanoutConnections = createIcePiFanoutConnections()
  const fanoutByConnectionIndex = new Map<number, SimpleRouteConnection>([
    [0, fanoutConnections[0]!],
    [6, fanoutConnections[1]!],
  ])
  let localConnectionIndex = 0
  const connections: SimpleRouteConnection[] = Array.from(
    { length: 181 },
    (_, connectionIndex) => {
      const fanoutConnection = fanoutByConnectionIndex.get(connectionIndex)
      if (fanoutConnection) return fanoutConnection

      const column = localConnectionIndex % 20
      const row = Math.floor(localConnectionIndex / 20)
      const x = -10 + column * 0.4
      const y = -10 + row * 0.4
      const connection: SimpleRouteConnection = {
        name: `local_board_net_${localConnectionIndex}`,
        pointsToConnect: [
          { x, y, layer: "top" },
          { x: x + 0.15, y, layer: "top" },
        ],
      }
      localConnectionIndex++
      return connection
    },
  )

  return {
    bounds: { minX: -12, maxX: 25, minY: -12, maxY: 22 },
    layerCount: 6,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    obstacles: createIcePiPadObstacles(),
    connections,
  }
}
