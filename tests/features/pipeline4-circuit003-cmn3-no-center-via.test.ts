import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

const approxEqual = (a: number, b: number, epsilon = 1e-6) =>
  Math.abs(a - b) < epsilon

test(
  "pipeline4 circuit003 avoids center-via shortcut for cmn_3 same-point layer change",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const cmn3Meta =
      solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_3")
    expect(cmn3Meta).toBeDefined()

    const center = cmn3Meta!.node.center
    const sourceNet5Routes = (
      solver.highDensityRouteSolver?.routes ?? []
    ).filter((route) => route.connectionName === "source_net_5_mst0")

    const usesCenterVia = sourceNet5Routes.some((route) =>
      route.vias.some(
        (via) => approxEqual(via.x, center.x) && approxEqual(via.y, center.y),
      ),
    )

    expect(usesCenterVia).toBe(false)
  },
  { timeout: 60000 },
)
