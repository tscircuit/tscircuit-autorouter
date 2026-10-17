import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"

const circuit003 = (dataset01 as Record<string, unknown>)
  .circuit003 as SimpleRouteJson

test("Pipeline 7 requires an explicit via-in-pad opt-in", () => {
  for (const allowViaInPad of [undefined, false, true] as const) {
    const input: SimpleRouteJson = {
      ...structuredClone(circuit003),
      allowViaInPad,
    }
    const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
      cacheProvider: null,
    })

    solver.solve()

    const [pathingParams] =
      solver.portPointPathingSolver!.getConstructorParams()
    expect(
      pathingParams.graph.regions.some((region) =>
        region.regionId.startsWith("layer-transition:"),
      ),
    ).toBe(allowViaInPad === true)
    const [forceImproveParams] =
      solver.highDensityForceImproveSolver!.getConstructorParams()
    expect(forceImproveParams.protectOverBudgetRegions).toBe(
      allowViaInPad ?? false,
    )
    const [params] =
      solver.exactGeometryDrcForceImproveSolver!.getConstructorParams()
    expect(params.enableViaInPadLayerMoves).toBe(allowViaInPad ?? false)
  }
})
