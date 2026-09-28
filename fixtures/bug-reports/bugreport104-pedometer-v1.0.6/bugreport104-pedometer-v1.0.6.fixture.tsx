import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import pedometer from "../bugreport104-pedometer-v1.0.6.unrouted.srj.json"

const srj: SimpleRouteJson = { ...(pedometer as SimpleRouteJson), traces: [] }

export default () => <AutoroutingPipelineDebugger srj={srj} />
