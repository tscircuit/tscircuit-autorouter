import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { scopedClearanceFixture } from "./fixtures/scoped-clearance"

test("reference and optimized repair DRC retain net-specific layer clearances after point pairing", () => {
  for (const layer of ["top", "bottom", "inner1"] as const) {
    const { srj, traces } = scopedClearanceFixture(layer)
    const pairs = new NetToPointPairsSolver(srj, {}, new ConnectivityMap({}))
    pairs.solve()
    const paired = pairs.getNewSimpleRouteJson()
    expect(paired.clearanceRules).toEqual(srj.clearanceRules)
    expect(
      paired.connections
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((connection) => connection.sourceNetIds),
    ).toEqual(srj.connections.map((connection) => connection.sourceNetIds))
    const reference = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: paired,
      routedTraces: traces,
      drcOptions: { includeTraceContinuity: false },
    })
    const optimized = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: srj,
      srjWithPointPairs: paired,
      drcOptions: { includeTraceContinuity: false },
    })(traces)
    for (const result of [reference, optimized]) {
      const scoped = result.errors.filter(
        (error) => error.type === "pcb_clearance_error",
      )
      expect(scoped).toHaveLength(layer === "inner1" ? 0 : 1)
      if (layer !== "inner1")
        expect(
          "minimum_clearance" in scoped[0]!
            ? scoped[0]!.minimum_clearance
            : undefined,
        ).toBe(4.14)
    }
  }
})
