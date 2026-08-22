import type { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srjJson from "./bugreport97-mangopi-r3c-six-layer-power-expansion.srj.json"

const srj = srjJson as SimpleRouteJson

export default () => <AutoroutingPipelineDebugger srj={srj} />
