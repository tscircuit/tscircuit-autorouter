import { expect, test } from "bun:test"
import { createCachedStitchGapValidator } from "lib/solvers/RouteStitchingSolver/create-cached-stitch-gap-validator"

test("endpoint path search validates each undirected stitch gap once", () => {
  let exactPathCalls = 0
  const isValidStitchGap = createCachedStitchGapValidator({
    traceThickness: 0.15,
    isValidStitchSegment: () => false,
    findValidStitchPath: () => {
      exactPathCalls += 1
      return undefined
    },
  })

  const forwardGap = {
    connectionName: "conn",
    start: { x: 1, y: 2, z: 0 },
    end: { x: 3, y: 4, z: 0 },
  }
  expect(isValidStitchGap(forwardGap)).toBe(false)
  expect(
    isValidStitchGap({
      ...forwardGap,
      start: forwardGap.end,
      end: forwardGap.start,
    }),
  ).toBe(false)
  expect(exactPathCalls).toBe(1)
})
