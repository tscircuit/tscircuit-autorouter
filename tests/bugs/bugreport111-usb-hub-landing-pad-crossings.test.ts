import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport111-0535ad/bugreport111-0535ad.json" with {
  type: "json",
}

test("bugreport111: Pipeline 9 plans no other net across the pads its fixed crystal traces land on", (): void => {
  const input = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  const fixedTraceIds = new Set(
    input.traces!.map((trace) => trace.pcb_trace_id),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("highDensityRouteSolver")
  expect(solver.failed).toBe(false)

  // The crystal nets are fully routed by the fixed traces, so every path
  // planned through one of their pads belongs to some other net.
  const landingPadByNodeId = new Map(
    solver
      .capacityNodes!.filter(
        (node) =>
          node._containsObstacle &&
          node._connectedTo?.some((id) => fixedTraceIds.has(id)),
      )
      .map((node) => [node.capacityMeshNodeId, node._connectedTo![0]!]),
  )
  expect(new Set(landingPadByNodeId.values())).toEqual(
    new Set([
      "pcb_smtpad_26",
      "pcb_smtpad_27",
      "pcb_smtpad_55",
      "pcb_smtpad_57",
      "pcb_smtpad_59",
      "pcb_smtpad_61",
    ]),
  )
  const crossings = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.flatMap((node) =>
      landingPadByNodeId.has(node.capacityMeshNodeId)
        ? (node.portPointsInPairs ?? []).map(
            ([entry]) =>
              `${landingPadByNodeId.get(node.capacityMeshNodeId)} ${entry.rootConnectionName}`,
          )
        : [],
    )
    .sort()
  expect(crossings).toEqual([])
})
