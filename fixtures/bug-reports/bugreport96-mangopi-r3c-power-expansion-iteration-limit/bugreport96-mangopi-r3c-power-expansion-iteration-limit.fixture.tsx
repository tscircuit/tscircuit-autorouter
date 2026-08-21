import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import type { SimpleRouteJson } from "lib/types"
import constructorArgsJson from "./bugreport96-mangopi-r3c-power-expansion-iteration-limit.input.json"

const [inputSrj, options] = constructorArgsJson as [
  SimpleRouteJson,
  PowerTraceExpanderOptions,
]

const createSolver = (): PowerTraceExpansionSolver =>
  new PowerTraceExpansionSolver(
    structuredClone(inputSrj),
    structuredClone(options),
  )

export default () => <GenericSolverDebugger createSolver={createSolver} />
