import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 dataset01 circuit003 keeps same-net obstacle IDs out of contiguity endpoints", () => {
  const circuit003 = (dataset01 as Record<string, unknown>)
    .circuit003 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit003),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.srjWithPointPairs).toBeDefined()
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Pipeline7 did not produce point-pair routing input")
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: circuit003,
    srjWithPointPairs,
    traces: solver.getOutputSimplifiedPcbTraces(),
  })
  const sourceTrace19 = circuitJson.find(
    (
      element,
    ): element is Extract<
      (typeof circuitJson)[number],
      { type: "source_trace" }
    > =>
      element.type === "source_trace" &&
      element.source_trace_id === "source_trace_19",
  )

  expect(sourceTrace19?.connected_source_port_ids.sort()).toEqual([
    "pcb_port_22",
    "pcb_port_28",
  ])
  expect(sourceTrace19?.connected_source_net_ids).toContain("pcb_port_24")
  expect(sourceTrace19?.connected_source_net_ids).toContain("pcb_port_26")

  expect(errors).toHaveLength(0)
})
