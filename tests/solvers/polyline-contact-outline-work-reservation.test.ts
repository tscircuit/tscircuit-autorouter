import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("large physical outlines are reserved before any polygon edge work", (): void => {
  const { context } = createPolylineContactFixture()
  let inspectedVertices = 0
  const outline = new Proxy(Array.from({ length: 1000 }, (_, index) => ({
    x: Math.cos(index * Math.PI / 500) * 3, y: Math.sin(index * Math.PI / 500) * 2,
  })), { get(target, key, receiver) {
    if (typeof key === "string" && /^\d+$/.test(key)) inspectedVertices++
    return Reflect.get(target, key, receiver)
  } })
  let work = 0
  expect((): void => {
    validatePolylineContactRoutes([{ connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }], vias: [] }], {
      ...context, boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 }, outline },
    }, (units): void => {
      if (work + units > 5000) throw new Error("physical reservation exhausted")
      work += units
    })
  }).toThrow("physical reservation exhausted")
  expect(inspectedVertices).toBe(0)
  expect(work).toBeLessThanOrEqual(5000)
})
