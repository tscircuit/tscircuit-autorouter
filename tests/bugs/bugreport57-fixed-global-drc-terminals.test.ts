import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport57-51db46/bugreport57-51db46.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("global DRC repair keeps bug57 terminals fixed", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const targetEndpoint = solver
    .globalDrcForceImproveSolver!.getOutput()
    .flatMap((route) => route.route)
    .find((point) => point.pcb_port_id === "pcb_port_44")
  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimplifiedPcbTraces(),
    {
      minTraceWidth: srj.minTraceWidth,
      minViaDiameter: srj.minViaDiameter,
    },
  )
  const drcResult = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

  expect(targetEndpoint).toMatchObject({
    x: -14.379999999999999,
    y: 5.079999999999999,
    pcb_port_id: "pcb_port_44",
  })
  expect(drcResult.errors).toEqual([])
})
