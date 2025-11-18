import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import mixedConnectionsSrj from "./assets/mixed-connections.srj.json"
import React from "react"

export default () => {
  return <AutoroutingPipelineDebugger srj={mixedConnectionsSrj} />
}
