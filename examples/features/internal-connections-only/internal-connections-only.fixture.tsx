import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import internalConnectionsOnlySrj from "assets/internal-connections-only.srj.json"
import React from "react"
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={internalConnectionsOnlySrj as SimpleRouteJson}
    />
  )
}
