import { test, expect } from "bun:test"
import { SimpleHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/SimpleHighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "../examples/legacy/assets/simpleHighDensityRouteSolverInput.json" assert {
  type: "json",
}

test("SimpleHighDensitySolver - solves high density routes", () => {
  const nodePortPoints = input.flatMap((item: any) => item.nodePortPoints)

  const colorMap: Record<string, string> = {}
  for (const node of nodePortPoints) {
    const nodeColorMap = generateColorMapFromNodeWithPortPoints(node)
    for (const [key, value] of Object.entries(nodeColorMap)) {
      colorMap[key] = value
    }
  }

  const solver = new SimpleHighDensitySolver({
    nodePortPoints,
    colorMap,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.routes.length).toBeGreaterThan(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
