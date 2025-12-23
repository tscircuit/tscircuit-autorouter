import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { SimpleHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/SimpleHighDensitySolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import input from "../../legacy/assets/simpleHighDensityRouteSolverInput.json"

export default () => {
  const createSolver = () => {
    const nodePortPoints = input.flatMap((item: any) => item.nodePortPoints)

    const colorMap: Record<string, string> = {}
    for (const node of nodePortPoints) {
      const nodeColorMap = generateColorMapFromNodeWithPortPoints(node)
      for (const [key, value] of Object.entries(nodeColorMap)) {
        colorMap[key] = value
      }
    }

    return new SimpleHighDensitySolver({
      nodePortPoints,
      colorMap,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
