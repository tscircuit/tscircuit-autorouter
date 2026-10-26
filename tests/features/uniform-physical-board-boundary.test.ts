import { expect, test } from "bun:test"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("physical shared-port domains respect exact board bounds and the static outline tolerance", (): void => {
  const fixture = createPhysicalUniformScenario({ rules: {
    bounds: { minX: -1, maxX: 1.4, minY: -1, maxY: 1 },
    outline: [{ x: -1, y: -0.0499995 }, { x: 1.4, y: -0.0499995 }, { x: 1.4, y: 1 }, { x: -1, y: 1 }],
  } })
  fixture.solver.solve()
  const point = fixture.solver.getOutput()[0]!.portPoints[0]!
  expect(point.y).toBe(0)
  expect(point.x - 0.05).toBeGreaterThanOrEqual(-1)
  expect(point.x + 0.05).toBeLessThanOrEqual(1.4)
  expect(point.x > 0 && point.x < 2).toBeTrue()
})
