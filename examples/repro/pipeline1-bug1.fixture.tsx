import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import bugReproJson from "tests/repro/pipeline1-bug1.json"
import type { SimpleRouteJson } from "lib/types"
import React from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        return new AutoroutingPipeline1_OriginalUnravel(
          bugReproJson as SimpleRouteJson,
          {
            cacheProvider: null,
          },
        )
      }}
    />
  )
}
