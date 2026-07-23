import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("endpoint path search validates each undirected stitch gap once", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [],
    hdRoutes: [],
    layerCount: 2,
  })
  let exactPathCalls = 0
  const internalSolver = solver as any
  internalSolver.isValidStitchSegment = () => false
  internalSolver.findValidStitchPath = () => {
    exactPathCalls += 1
    return undefined
  }

  const forwardGap = {
    connectionName: "conn",
    start: { x: 1, y: 2, z: 0 },
    end: { x: 3, y: 4, z: 0 },
  }
  expect(internalSolver.isValidStitchGap(forwardGap)).toBe(false)
  expect(
    internalSolver.isValidStitchGap({
      ...forwardGap,
      start: forwardGap.end,
      end: forwardGap.start,
    }),
  ).toBe(false)
  expect(exactPathCalls).toBe(1)
})
