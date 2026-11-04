import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import type { ReactElement } from "react"
import { GzipRepro } from "./GzipRepro"

type Params = ConstructorParameters<
  typeof GrowShrinkHighDensityIntraNodeSolver
>[0]
type CapturedInput = Omit<Params, "connMap"> & {
  connMap: Record<string, string[]>
}

const url = new URL(
  "../../../tests/fixtures/assets/a64-ddr-cmn142-resized-search.json.gz",
  import.meta.url,
).href

export default function A64RegionRepro(): ReactElement {
  return (
    <div>
      <p>
        Real A64 cmn_142 checkpoint: all 38 terminals, 19 route requests and
        original obstacle/ownership context. Step into the portfolio to inspect
        its grid candidates, or Solve to see the emitted routes. The baseline
        exceeds 2 GiB; this is a local region, not a full-board DRC pass.
      </p>
      <GzipRepro<CapturedInput> url={url}>
        {(input) => (
          <GenericSolverDebugger
            createSolver={() => {
              const captured = structuredClone(input)
              return new GrowShrinkHighDensityIntraNodeSolver({
                ...captured,
                connMap: new ConnectivityMap(captured.connMap),
              })
            }}
          />
        )}
      </GzipRepro>
    </div>
  )
}
