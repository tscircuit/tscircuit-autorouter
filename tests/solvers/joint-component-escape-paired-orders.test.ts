import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("joint escape planning leaves a one-interface local minimum by changing both components", () => {
  const input = createJointComponentEscapeFixture()
  const original = structuredClone(input)
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.predictedCrossingsBefore).toBe(2)
  expect(solver.stats.predictedCrossingsAfter).toBe(0)
  expect(solver.stats.jointlyReorderedFamilyPairs).toBe(1)
  expect(solver.stats.reorderedPortalCount).toBe(4)
  expect(solver.stats.candidateAssignmentsEvaluated).toBeGreaterThan(0)
  expect(input).toEqual(original)
  for (const node of solver.getOutput()) {
    for (const [start, end] of node.portPointsInPairs!) {
      // The selected modes have an immediate finite-width physical witness:
      // parallel horizontal segments, two millimeters apart, without vias.
      expect(start.y).toBe(end.y)
      expect(start.z).toBe(end.z)
      expect(start.connectionName).toBe(end.connectionName)
      if (start.pcb_port_id) expect(start).toEqual(original.nodesWithPortPoints.flatMap((n) => n.portPoints).find((p) => p.pcb_port_id === start.pcb_port_id)!)
      if (end.pcb_port_id) expect(end).toEqual(original.nodesWithPortPoints.flatMap((n) => n.portPoints).find((p) => p.pcb_port_id === end.pcb_port_id)!)
    }
  }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.2, obstacles: [],
    bounds: { minX: -5, maxX: 15, minY: -2, maxY: 2 }, connections: input.connections }
  const traces: SimplifiedPcbTrace[] = ["A", "B"].map((name) => {
    const pairs = solver.getOutput().map((node) => node.portPointsInPairs!.find(([point]) => point.connectionName === name)!)
    return { type: "pcb_trace", pcb_trace_id: `witness-${name}`, connection_name: name,
      route: [pairs[0]![0], ...pairs.map((pair) => pair[1])].map((point) => ({ route_type: "wire", x: point.x, y: point.y, layer: "top", width: 0.2 })),
    }
  })
  expect(evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: srj, routedTraces: traces, includeBoardClearance: true }).errors).toHaveLength(0)
})
