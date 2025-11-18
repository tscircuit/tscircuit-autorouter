import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import mixedConnectionsSrj from "./assets/mixed-connections.srj.json"
import React from "react"
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger srj={mixedConnectionsSrj as SimpleRouteJson} />
  )
}
