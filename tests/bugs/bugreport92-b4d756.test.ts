import { expect, test } from "bun:test"
import { runAllChecks } from "@tscircuit/checks"
import type { PcbBoard } from "circuit-json"
import { AutoroutingPipelineSolver } from "lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import bugReport from "../../fixtures/bug-reports/bugreport92-b4d756/bugreport92-b4d756.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport92 keeps the TRRS trace clear of the board edge", async () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Solver did not produce point-pair SRJ")
  }

  const circuitJson = convertToCircuitJson(
    srjWithPointPairs,
    solver.getOutputSimplifiedPcbTraces(),
    {
      minTraceWidth: srj.minTraceWidth,
      originalSrj: srj,
    },
  )
  const board = {
    type: "pcb_board",
    pcb_board_id: "pcb_board_0",
    thickness: 1.6,
    num_layers: srj.layerCount,
    center: {
      x: (srj.bounds.minX + srj.bounds.maxX) / 2,
      y: (srj.bounds.minY + srj.bounds.maxY) / 2,
    },
    outline: srj.outline,
    shape: "polygon",
    material: "fr4",
    min_board_edge_clearance: srj.minBoardEdgeClearance,
  } satisfies PcbBoard
  const strictDrcErrors = await runAllChecks([...circuitJson, board])
  const trrsBoardEdgeErrors = strictDrcErrors.filter(
    (error) =>
      "pcb_trace_id" in error &&
      error.pcb_trace_id.includes("source_trace_165") &&
      error.message.includes("board edge"),
  )

  expect(trrsBoardEdgeErrors).toEqual([])
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
