import { expect, test } from "bun:test"
import {
  getFixedCopperPortNetId,
  type FixedCopperGeometry,
} from "lib/utils/getFixedCopperPortNetId"

test("physical pad corridors reserve only legal trace ports across rotations and layers", () => {
  for (const rotation of [0, 37, 90]) {
    const angle = (rotation * Math.PI) / 180
    const transform = (x: number, y: number) => ({
      x: 12.3 + x * Math.cos(angle) - y * Math.sin(angle),
      y: -4.2 + x * Math.sin(angle) + y * Math.cos(angle),
    })
    const geometry: FixedCopperGeometry = {
      routes: [],
      traceWidth: 0.15,
      clearance: 0.1,
      obstacles: [-1, 1].map((side) => ({
        type: "rect",
        center: transform(0, side * 0.2),
        width: 1,
        height: 0.2,
        ccwRotationDegrees: rotation,
        zLayers: [0],
        netId: `net-${side}`,
      })),
    }
    const point = { ...transform(0, 0), z: 0 }
    // The 0.2 mm gap cannot contain a 0.15 mm trace and two 0.1 mm clearances.
    expect(getFixedCopperPortNetId(point, geometry)).toBeNull()
    expect(getFixedCopperPortNetId({ ...point, z: 1 }, geometry)).toBeUndefined()
    geometry.obstacles![1]!.netId = "net--1"
    expect(getFixedCopperPortNetId(point, geometry)).toBe("net--1")
    geometry.obstacles!.forEach((obstacle, index) => {
      obstacle.center = transform(0, (index === 0 ? -1 : 1) * 0.3)
    })
    expect(getFixedCopperPortNetId(point, geometry)).toBeUndefined()
    geometry.obstacles!.forEach((obstacle, index) => {
      obstacle.center = transform(0, (index === 0 ? -1 : 1) * 0.275)
    })
    expect(getFixedCopperPortNetId(point, geometry)).toBeUndefined()
    geometry.obstacles!.forEach((obstacle, index) => {
      obstacle.center = transform(0, (index === 0 ? -1 : 1) * (0.275 - 1e-9))
    })
    expect(getFixedCopperPortNetId(point, geometry)).toBe("net--1")
  }
  const roundPad: FixedCopperGeometry = {
    routes: [],
    traceWidth: 0.15,
    clearance: 0.1,
    obstacles: [
      {
        type: "oval",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        zLayers: [0, 1],
        netId: "pad-net",
      },
    ],
  }
  expect(
    getFixedCopperPortNetId({ x: 0.3, y: 0.3, z: 0 }, roundPad),
  ).toBeUndefined()
  roundPad.obstacles![0]!.type = "rect"
  expect(getFixedCopperPortNetId({ x: 0.3, y: 0.3, z: 0 }, roundPad)).toBe(
    "pad-net",
  )
})
