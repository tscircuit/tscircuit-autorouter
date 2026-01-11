import { test, expect } from "bun:test"
import { JumperHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/JumperHighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "../../fixtures/features/jumper-high-density/jumper-high-density08-input.json" with {
  type: "json",
}

test(
  "JumperHighDensitySolver08 - solves high density routes with jumpers",
  () => {
    const nodePortPoints = (input as any[]).flatMap(
      (item: any) => item.nodePortPoints,
    )

    const colorMap: Record<string, string> = {}
    for (const node of nodePortPoints) {
      const nodeColorMap = generateColorMapFromNodeWithPortPoints(node)
      for (const [key, value] of Object.entries(nodeColorMap)) {
        colorMap[key] = value
      }
    }

    const solver = new JumperHighDensitySolver({
      nodePortPoints,
      colorMap,
    })

    solver.solve()

    expect(solver.solved || solver.failed).toBe(true)
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  },
  { timeout: 30000 },
)
