import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "./receiver-40b373.json"

const srj: SimpleRouteJson = bugReport.simple_route_json

export default () => <AutoroutingPipelineDebugger srj={srj} />
