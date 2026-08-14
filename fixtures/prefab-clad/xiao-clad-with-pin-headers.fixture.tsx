import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { createXiaoCladSrj } from "./create-xiao-clad-srj"

export default () => (
  <AutoroutingPipelineDebugger srj={createXiaoCladSrj(true)} />
)
