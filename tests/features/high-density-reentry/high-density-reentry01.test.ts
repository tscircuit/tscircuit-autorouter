import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "fixtures/features/high-density-reentry/high-density-reentry01-input.json" with {
  type: "json",
}
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import { getSvgFromGraphicsObject } from "graphics-debug"

test("high-density-reentry01 documents flat nodeWithPortPoints reentry ambiguity", () => {
  const resolvedInput = (input as any).default ?? input
  const nodePortPoints = resolvedInput.nodePortPoints
  const colorMap = generateColorMapFromNodeWithPortPoints(nodePortPoints[0])

  const solver = new HighDensitySolver({
    nodePortPoints: structuredClone(nodePortPoints),
    colorMap,
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
