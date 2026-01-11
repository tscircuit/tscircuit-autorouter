import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { JumperHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/JumperHighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "./jumper-high-density08-input.json"

export default () => {
  const createSolver = () => {
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

    return new JumperHighDensitySolver({
      nodePortPoints,
      colorMap,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
