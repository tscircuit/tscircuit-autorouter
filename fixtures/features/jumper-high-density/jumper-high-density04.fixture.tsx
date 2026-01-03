import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { JumperHighDensitySolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/JumperHighDensitySolver"
import input from "./jumper-high-density04-input.json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    return new JumperHighDensitySolver({
      nodePortPoints: input[0].nodePortPoints as any,
      colorMap: input[0].colorMap,
      traceWidth: input[0].traceWidth,
      viaDiameter: input[0].viaDiameter,
      connMap: new ConnectivityMap(input[0].connMap.netMap as any),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
