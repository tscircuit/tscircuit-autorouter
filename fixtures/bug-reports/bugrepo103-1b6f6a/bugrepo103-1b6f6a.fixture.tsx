import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import srj from "./bugrepo103-1b6f6a.srj.json"

export default function Repro(): ReactElement {
  return <AutoroutingPipelineDebugger srj={srj as SimpleRouteJson} />
}
