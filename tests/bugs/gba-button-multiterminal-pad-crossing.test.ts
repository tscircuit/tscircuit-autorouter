import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/gba-button-multiterminal-pad-crossing/gba-button-multiterminal-pad-crossing.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("Pipeline9 accepts traces crossing internally connected switch pads", () => {
  // Exact button-pad positions and switch connectivity metadata extracted from
  // the full Game Boy Advance SRJ. No routed traces or route hints are preset.
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(errors).toEqual([])

  // Validate exactly the same automatically routed copper without the switch's
  // internal connections. Undeclared pad contacts must still be reported.
  const srjWithoutInternalConnections = structuredClone(srj)
  const pointPairsWithoutInternalConnections = structuredClone(
    solver.srjWithPointPairs!,
  )
  for (const validationSrj of [
    srjWithoutInternalConnections,
    pointPairsWithoutInternalConnections,
  ]) {
    for (const obstacle of validationSrj.obstacles) {
      delete obstacle.offBoardConnectsTo
    }
  }
  const { errors: undeclaredContactErrors } = evaluateRelaxedDrc({
    inputSrj: srjWithoutInternalConnections,
    srjWithPointPairs: pointPairsWithoutInternalConnections,
    routedTraces,
  })
  expect(undeclaredContactErrors).toHaveLength(4)
  const traceErrors = undeclaredContactErrors.filter(
    (error) => error.type === "pcb_trace_error",
  )
  expect(traceErrors).toHaveLength(4)
  expect(
    traceErrors
      .flatMap((error) => error.pcb_port_ids ?? [])
      .filter((portId) =>
        [
          "pcb_port_365",
          "pcb_port_369",
          "pcb_port_382",
          "pcb_port_386",
        ].includes(portId),
      )
      .sort(),
  ).toEqual(["pcb_port_365", "pcb_port_369", "pcb_port_382", "pcb_port_386"])
  for (const error of traceErrors) {
    const errorPortIds = error.pcb_port_ids ?? []
    const crossedPortId = errorPortIds.at(-1)
    const crossedPad = srj.obstacles.find(
      (obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === crossedPortId,
    )
    const endpointPads = srj.obstacles.filter((obstacle) =>
      errorPortIds
        .slice(0, -1)
        .includes(obstacle.circuitJsonMetadata?.pcb_port_id ?? ""),
    )
    expect(
      endpointPads.some((endpointPad) =>
        endpointPad.offBoardConnectsTo?.some((internalConnectionId) =>
          crossedPad?.offBoardConnectsTo?.includes(internalConnectionId),
        ),
      ),
    ).toBeTrue()
  }
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
