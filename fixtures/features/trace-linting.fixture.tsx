import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import traceLintingSrj from "tests/fixtures/trace-linting.srj.json"

export default function TraceLintingFixture(): React.ReactElement {
  return <AutoroutingPipelineDebugger srj={traceLintingSrj} />
}
