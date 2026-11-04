import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import type { ReactElement } from "react"
import { GzipRepro } from "../ddr-memory/GzipRepro"

type CapturedInput = {
  input: ConstructorParameters<typeof Pipeline9HighDensityForceImproveSolver>[0]
}

const url = new URL(
  "../../../tests/fixtures/h3-ddr-cmn9-force-input.json.gz",
  import.meta.url,
).href

export default function H3ForceCheckpointRepro(): ReactElement {
  return (
    <div>
      <p>
        Actual H3 cmn_9 force-stage input: 23 routes, 2,459 points, all 20 force
        steps. Step or Solve to run the current Pipeline9 adapter and inspect
        its elapsed time and routes. Compare with the stacked force-improvement
        fix: the output must match the same original bytes on both revisions.
      </p>
      <p>
        The ddr-memory / h3-real-board fixture runs the complete original
        circuit from its board input. This checkpoint skips the earlier routing
        stages. Local stage completion does not establish a full-board DRC pass.
      </p>
      <GzipRepro<CapturedInput> url={url}>
        {(captured) => (
          <GenericSolverDebugger
            createSolver={() =>
              new Pipeline9HighDensityForceImproveSolver(
                structuredClone(captured.input),
              )
            }
          />
        )}
      </GzipRepro>
    </div>
  )
}
