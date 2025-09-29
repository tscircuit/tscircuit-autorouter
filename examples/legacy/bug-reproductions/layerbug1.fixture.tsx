import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import boardWithTopAndBottom from "examples/legacy/assets/boardwithtopandbottom.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={boardWithTopAndBottom as any} />
}
