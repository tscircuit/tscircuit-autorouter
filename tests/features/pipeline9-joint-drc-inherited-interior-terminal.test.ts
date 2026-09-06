import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 rejects a DRC-clean proposal that moves a real interior terminal", (): void => {
  const fixture = createPipeline9InheritedPadClearanceFixture()
  // Extend only a cloned test input, before constructing the solver under test.
  const srj = structuredClone(fixture.srj)
  const trace = srj.traces![0]!
  const terminal = trace.route[1]!
  if (terminal.route_type !== "wire") {
    throw new Error("Expected an interior wire terminal in the fixture")
  }
  terminal.start_pcb_port_id = "preloaded_interior"
  srj.connections[0]!.pointsToConnect.splice(1, 0, {
    x: terminal.x,
    y: terminal.y,
    layer: terminal.layer,
    pointId: "preloaded_interior",
    pcb_port_id: "preloaded_interior",
  })
  srj.obstacles.push({
    type: "rect",
    center: { x: terminal.x, y: terminal.y },
    width: 0.1,
    height: 0.1,
    layers: ["top"],
    connectedTo: ["preloaded_interior"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "pad_interior",
      pcb_port_id: "preloaded_interior",
    },
  })
  const originalSrj = structuredClone(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    ...fixture.solver.params,
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    updatedPreloadedTraces: srj.traces!,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
  })
  const section = solver.movablePreloadedSections[0]!
  expect(section.hdRoute.route[1]).toMatchObject({
    x: terminal.x,
    y: terminal.y,
    z: 0,
    pcb_port_id: "preloaded_interior",
  })
  const exactRepair = solver.exactRepairSolver
  if (!exactRepair) throw new Error("Expected inherited copper exact repair")
  const unchangedCandidate = structuredClone(exactRepair.params.hdRoutes)

  // Publication-state contract: unchanged geometry must preserve the raw tag.
  solver["publishValidatedOutput"](unchangedCandidate)

  expect(solver.stats.jointOutputAccepted).toBeTrue()
  expect(solver.getUpdatedPreloadedTraces()[0]?.route[1]).toEqual(terminal)
  const movedCandidate = structuredClone(unchangedCandidate)
  for (const point of movedCandidate[0]!.route.slice(1, -1)) {
    point.y = -0.5
  }
  const movedTrace = structuredClone(trace)
  movedTrace.__replaces_pcb_trace_id = trace.pcb_trace_id
  for (const point of movedTrace.route.slice(1, -1)) {
    if (point.route_type === "wire") point.y = -0.5
  }
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [],
    }).errors,
  ).toHaveLength(1)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [movedTrace],
    }).errors,
  ).toHaveLength(0)

  solver["publishValidatedOutput"](movedCandidate)

  expect(solver.stats.jointOutputAccepted).toBeFalse()
  expect(solver.stats.jointOutputRejectedForTerminalMetadata).toBeTrue()
  expect(solver.stats.publishedJointDrcIssueCount).toBe(1)
  expect(solver.getUpdatedPreloadedTraces()).toBe(srj.traces!)
  expect(solver.getUpdatedPreloadedTraces()[0]?.route[1]).toBe(terminal)
  expect(solver.getMutatedPreloadedTraces()).toEqual([])
  expect(srj).toEqual(originalSrj)
})
