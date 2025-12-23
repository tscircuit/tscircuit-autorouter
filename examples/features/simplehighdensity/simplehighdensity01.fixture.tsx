import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { SimpleHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/SimpleHighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "../../legacy/assets/simpleHighDensityRouteSolverInput.json"

export default () => {
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

  const graphics = solver.visualize()

  return <InteractiveGraphics graphics={graphics} />
}
