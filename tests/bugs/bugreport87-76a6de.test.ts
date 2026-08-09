import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import bugReport from "../../fixtures/bug-reports/bugreport87-76a6de/bugreport87-76a6de.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport87-76a6de.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()
    const output = solver.getOutputSimplifiedPcbTraces()
    const hasWideTraceViaArray = output
      .filter((trace) => trace.connection_name === "source_net_0")
      .some((trace) =>
        trace.route.some(
          (point, index) =>
            point.route_type === "via" &&
            trace.route[index + 1]?.route_type === "via",
        ),
      )

    expect(hasWideTraceViaArray).toBe(true)
    const srjWithPointPairs = solver.srjWithPointPairs ?? srj
    const preExpansionDrc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces: solver.getPrePowerTraceOutputSimplifiedPcbTraces(),
    })
    const postExpansionDrc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces: output,
    })
    expect(postExpansionDrc.errors.length).toBeLessThanOrEqual(
      preExpansionDrc.errors.length,
    )
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)
