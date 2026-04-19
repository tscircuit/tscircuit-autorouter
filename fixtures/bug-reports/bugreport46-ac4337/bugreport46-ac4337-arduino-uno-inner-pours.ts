import type { Obstacle, SimpleRouteJson } from "lib/types"
import bugReportJson from "./bugreport46-ac4337-arduino-uno.json"

// In the Uno power header row at y=-24.13, source_net_0 owns the
// IOREF/5V-aligned positions and source_net_3 owns the two adjacent GND pins.
export const ARDUINO_UNO_POWER_NET = "source_net_0"
export const ARDUINO_UNO_GROUND_NET = "source_net_3"

const baseSrj = bugReportJson.simple_route_json as SimpleRouteJson
type CopperPourLayer = "bottom" | "inner1" | "inner2"

const createCopperPour = ({
  obstacleId,
  layer,
  connectedTo,
  srj,
}: {
  obstacleId: string
  layer: CopperPourLayer
  connectedTo: string[]
  srj: SimpleRouteJson
}): Obstacle => ({
  obstacleId,
  type: "rect",
  layers: [layer],
  center: {
    x: (srj.bounds.minX + srj.bounds.maxX) / 2,
    y: (srj.bounds.minY + srj.bounds.maxY) / 2,
  },
  width: srj.bounds.maxX - srj.bounds.minX,
  height: srj.bounds.maxY - srj.bounds.minY,
  connectedTo,
  isCopperPour: true,
})

const createArduinoUnoWithPowerGroundPours = ({
  powerLayer,
  groundLayer,
}: {
  powerLayer: CopperPourLayer
  groundLayer: CopperPourLayer
}): SimpleRouteJson => {
  const srj = structuredClone(baseSrj) as SimpleRouteJson

  srj.layerCount = 4
  srj.obstacles = [
    ...srj.obstacles,
    createCopperPour({
      obstacleId: `arduino-uno-${powerLayer}-power-pour`,
      layer: powerLayer,
      connectedTo: [ARDUINO_UNO_POWER_NET],
      srj,
    }),
    createCopperPour({
      obstacleId: `arduino-uno-${groundLayer}-ground-pour`,
      layer: groundLayer,
      connectedTo: [ARDUINO_UNO_GROUND_NET],
      srj,
    }),
  ]

  return srj
}

export const arduinoUnoWithPowerGroundInnerPours: SimpleRouteJson =
  createArduinoUnoWithPowerGroundPours({
    powerLayer: "inner1",
    groundLayer: "inner2",
  })

export const arduinoUnoWithPowerGroundBottomInner2Pours: SimpleRouteJson =
  createArduinoUnoWithPowerGroundPours({
    powerLayer: "bottom",
    groundLayer: "inner2",
  })
