// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import reproJson from "./repro117-standalone-simple-route.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={reproJson} />
}
