import { expect, test } from "bun:test"
import {
  ARDUINO_UNO_GROUND_NET,
  ARDUINO_UNO_POWER_NET,
  arduinoUnoWithPowerGroundInnerPours,
} from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno-inner-pours"

test("Arduino Uno inner-pour fixture adds inner1 power and inner2 ground pours", () => {
  const srj = arduinoUnoWithPowerGroundInnerPours

  expect(srj.layerCount).toBe(4)
  expect(srj.connections.some((c) => c.name === ARDUINO_UNO_POWER_NET)).toBe(
    true,
  )
  expect(srj.connections.some((c) => c.name === ARDUINO_UNO_GROUND_NET)).toBe(
    true,
  )

  const powerPour = srj.obstacles.find(
    (obstacle) => obstacle.obstacleId === "arduino-uno-inner1-power-pour",
  )
  const groundPour = srj.obstacles.find(
    (obstacle) => obstacle.obstacleId === "arduino-uno-inner2-ground-pour",
  )

  expect(powerPour).toBeDefined()
  expect(powerPour?.isCopperPour).toBe(true)
  expect(powerPour?.layers).toEqual(["inner1"])
  expect(powerPour?.connectedTo).toEqual([ARDUINO_UNO_POWER_NET])
  expect(powerPour?.width).toBeCloseTo(srj.bounds.maxX - srj.bounds.minX, 6)
  expect(powerPour?.height).toBeCloseTo(srj.bounds.maxY - srj.bounds.minY, 6)

  expect(groundPour).toBeDefined()
  expect(groundPour?.isCopperPour).toBe(true)
  expect(groundPour?.layers).toEqual(["inner2"])
  expect(groundPour?.connectedTo).toEqual([ARDUINO_UNO_GROUND_NET])
  expect(groundPour?.width).toBeCloseTo(srj.bounds.maxX - srj.bounds.minX, 6)
  expect(groundPour?.height).toBeCloseTo(srj.bounds.maxY - srj.bounds.minY, 6)
})
