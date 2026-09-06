import { expect, test } from "bun:test"
import { createPipeline9JointDrcCandidateIdentityPlanner } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9JointDrcCandidateIdentityPlanner"
import type { SimplifiedPcbTrace } from "lib/types"

const createTrace = (pcbTraceId: string, y: number): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: pcbTraceId,
  route: [
    { route_type: "wire", x: -1, y, width: 0.1, layer: "top" },
    { route_type: "wire", x: 1, y, width: 0.1, layer: "top" },
  ],
})

test("Pipeline9 reuses trace identity plans while candidate geometry changes", () => {
  const preloadedTrace = createTrace("route_0", 2)
  const getIdentityPlan = createPipeline9JointDrcCandidateIdentityPlanner({
    originalPreloadedTraces: [preloadedTrace],
    movablePreloadedSections: [
      {
        originalTrace: preloadedTrace,
        syntheticConnectionName: "pipeline9_preloaded_drc_0",
        evaluationTraceId: "route_0__pipeline9_section_0",
      },
    ],
  })
  const firstPlan = getIdentityPlan([createTrace("route_0", 0)])
  const movedGeometryPlan = getIdentityPlan([createTrace("route_0", 1)])

  expect(movedGeometryPlan).toBe(firstPlan)
  expect(firstPlan.solverTraceIds).toEqual(["route_0_routed"])
  expect(firstPlan.solverTraceIdByEvaluationTraceId).toEqual(
    new Map([
      ["route_0_routed", "route_0"],
      ["route_0__pipeline9_section_0", "pipeline9_preloaded_drc_0_0"],
    ]),
  )

  const changedTopologyPlan = getIdentityPlan([
    createTrace("route_0", 1),
    createTrace("route_1", 1),
  ])
  expect(changedTopologyPlan).not.toBe(firstPlan)
  expect(changedTopologyPlan.solverTraceIds).toEqual([
    "route_0_routed",
    "route_1",
  ])
})
