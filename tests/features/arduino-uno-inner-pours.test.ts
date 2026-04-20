import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import {
  ARDUINO_UNO_GROUND_NET,
  ARDUINO_UNO_POWER_NET,
  arduinoUnoWithPowerGroundBottomInner2Pours,
  arduinoUnoWithPowerGroundInnerPours,
} from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno-inner-pours"

const expectPour = ({
  srj,
  obstacleId,
  layer,
  net,
}: {
  srj: typeof arduinoUnoWithPowerGroundInnerPours
  obstacleId: string
  layer: "bottom" | "inner1" | "inner2"
  net: string
}) => {
  const pour = srj.obstacles.find(
    (obstacle) => obstacle.obstacleId === obstacleId,
  )

  expect(pour).toBeDefined()
  expect(pour?.isCopperPour).toBe(true)
  expect(pour?.layers).toEqual([layer])
  expect(pour?.connectedTo).toEqual([net])
  expect(pour?.width).toBeCloseTo(srj.bounds.maxX - srj.bounds.minX, 6)
  expect(pour?.height).toBeCloseTo(srj.bounds.maxY - srj.bounds.minY, 6)
}

const expectBaseInvariant = (
  srj: typeof arduinoUnoWithPowerGroundInnerPours,
) => {
  expect(srj.layerCount).toBe(4)
  expect(srj.connections.some((c) => c.name === ARDUINO_UNO_POWER_NET)).toBe(
    true,
  )
  expect(srj.connections.some((c) => c.name === ARDUINO_UNO_GROUND_NET)).toBe(
    true,
  )
}

test("Arduino Uno inner-pour fixture adds inner1 power and inner2 ground pours", () => {
  const srj = arduinoUnoWithPowerGroundInnerPours

  expectBaseInvariant(srj)
  expectPour({
    srj,
    obstacleId: "arduino-uno-inner1-power-pour",
    layer: "inner1",
    net: ARDUINO_UNO_POWER_NET,
  })
  expectPour({
    srj,
    obstacleId: "arduino-uno-inner2-ground-pour",
    layer: "inner2",
    net: ARDUINO_UNO_GROUND_NET,
  })
})

test("Arduino Uno bottom/inner2 pour fixture adds bottom power and inner2 ground pours", async () => {
  const srj = arduinoUnoWithPowerGroundBottomInner2Pours

  expectBaseInvariant(srj)
  expectPour({
    srj,
    obstacleId: "arduino-uno-bottom-power-pour",
    layer: "bottom",
    net: ARDUINO_UNO_POWER_NET,
  })
  expectPour({
    srj,
    obstacleId: "arduino-uno-inner2-ground-pour",
    layer: "inner2",
    net: ARDUINO_UNO_GROUND_NET,
  })

  const solver = new AutoroutingPipelineSolver(structuredClone(srj), {
    effort: 1,
  })
  solver.solve()

  expect(
    srj.obstacles
      .filter((obstacle) => obstacle.isCopperPour)
      .map(({ obstacleId, layers, connectedTo, center, width, height }) => ({
        obstacleId,
        layers,
        connectedTo,
        center,
        width,
        height,
      })),
  ).toMatchInlineSnapshot(`
    [
      {
        "center": {
          "x": -0.08997937499999509,
          "y": 0,
        },
        "connectedTo": [
          "source_net_0",
        ],
        "height": 55.4,
        "layers": [
          "bottom",
        ],
        "obstacleId": "arduino-uno-bottom-power-pour",
        "width": 70.77995874999999,
      },
      {
        "center": {
          "x": -0.08997937499999509,
          "y": 0,
        },
        "connectedTo": [
          "source_net_3",
        ],
        "height": 55.4,
        "layers": [
          "inner2",
        ],
        "obstacleId": "arduino-uno-inner2-ground-pour",
        "width": 70.77995874999999,
      },
    ]
  `)
}, 120_000)
