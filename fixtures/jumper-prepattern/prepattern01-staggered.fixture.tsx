// import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver"
import input from "./prepattern01-input.json"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useMemo } from "react"

export default () => {
  const solver = useMemo(() => {
    return new JumperPrepatternSolver({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      traceWidth: input.traceWidth,
      hyperParameters: {
        PATTERN_TYPE: "staggered_grid",
      },
    })
  }, [])

  return <GenericSolverDebugger solver={solver as any} />
}
