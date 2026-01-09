// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import reproJson from "../../tests/repro/dip16-crossing-traces.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={reproJson} />
}
