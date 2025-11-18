import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import internalConnectionsOnlySrj from "./assets/internal-connections-only.srj.json"
import React from "react"

export default () => {
  return <AutoroutingPipelineDebugger srj={internalConnectionsOnlySrj} />
}
