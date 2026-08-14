import type { Obstacle, SimpleRouteJson } from "lib/types"

export const XIAO_CLAD_WIDTH = 21
export const XIAO_CLAD_HEIGHT = 17.8
export const XIAO_HEADER_PITCH = 2.54
export const XIAO_HEADER_ROW_X = 8.25

const PIN_COUNT_PER_ROW = 7
const HEADER_PAD_SIZE = 1.7
const CASTELLATED_PAD_WIDTH = 3
const CASTELLATED_PAD_HEIGHT = 2

const pinY = (pinIndex: number): number =>
  (PIN_COUNT_PER_ROW - 1) * (XIAO_HEADER_PITCH / 2) -
  pinIndex * XIAO_HEADER_PITCH

const createPinObstacle = (
  side: "left" | "right",
  pinIndex: number,
  withPinHeaders: boolean,
): Obstacle => {
  const connectionName = `xiao_pin_pair_${pinIndex + 1}`

  return {
    obstacleId: `obstacle_xiao_${side}_pin_${pinIndex + 1}`,
    componentId: withPinHeaders
      ? `pcb_component_xiao_${side}_header`
      : `pcb_component_xiao_${side}_castellations`,
    type: "rect",
    layers: withPinHeaders ? ["top", "bottom"] : ["top"],
    center: {
      x: side === "left" ? -XIAO_HEADER_ROW_X : XIAO_HEADER_ROW_X,
      y: pinY(pinIndex),
    },
    width: withPinHeaders ? HEADER_PAD_SIZE : CASTELLATED_PAD_WIDTH,
    height: withPinHeaders ? HEADER_PAD_SIZE : CASTELLATED_PAD_HEIGHT,
    connectedTo: [connectionName],
  }
}

const PREFAB_VIA_POSITIONS = [-5.5, -2.75, 0, 2.75, 5.5].flatMap((y) =>
  [-3.5, 0, 3.5].map((x) => ({ x, y })),
)

export const createXiaoCladSrj = (
  withPinHeaders: boolean,
): SimpleRouteJson => {
  const pinObstacles = Array.from(
    { length: PIN_COUNT_PER_ROW },
    (_, pinIndex) => [
      createPinObstacle("left", pinIndex, withPinHeaders),
      createPinObstacle("right", pinIndex, withPinHeaders),
    ],
  ).flat()

  const prefabViaObstacles: Obstacle[] = PREFAB_VIA_POSITIONS.map(
    (position, index) => ({
      obstacleId: `obstacle_xiao_prefab_via_${index + 1}`,
      type: "rect",
      layers: ["top", "bottom"],
      center: position,
      width: 1.2,
      height: 1.2,
      connectedTo: [],
      netIsAssignable: true,
    }),
  )

  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.2,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.2,
    bounds: {
      minX: -XIAO_CLAD_WIDTH / 2,
      maxX: XIAO_CLAD_WIDTH / 2,
      minY: -XIAO_CLAD_HEIGHT / 2,
      maxY: XIAO_CLAD_HEIGHT / 2,
    },
    obstacles: [...pinObstacles, ...prefabViaObstacles],
    connections: Array.from(
      { length: PIN_COUNT_PER_ROW },
      (_, pinIndex) => ({
        name: `xiao_pin_pair_${pinIndex + 1}`,
        pointsToConnect: [
          {
            x: -XIAO_HEADER_ROW_X,
            y: pinY(pinIndex),
            layer: "top",
            pointId: `xiao_left_pin_${pinIndex + 1}`,
          },
          {
            x: XIAO_HEADER_ROW_X,
            y: pinY(pinIndex),
            layer: "top",
            pointId: `xiao_right_pin_${pinIndex + 1}`,
          },
        ],
      }),
    ),
  }
}
