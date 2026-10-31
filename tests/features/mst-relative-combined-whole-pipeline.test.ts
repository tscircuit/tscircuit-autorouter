import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("both opt-in experiments compose without losing a manufactured bridge or reclassifying a clean output", () => {
  const input: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3, allowViaInPad: false,
    bounds: { minX: -2, minY: -2, maxX: 4, maxY: 2 },
    connections: [{ name: "net", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "top", pcb_port_id: "top" },
      { x: 0, y: 0, layer: "bottom", pointId: "bottom", pcb_port_id: "bottom" },
      { x: 2, y: 0, layer: "top", pointId: "far", pcb_port_id: "far" },
    ] }],
    obstacles: [
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["net", "top"], circuitJsonMetadata: { pcb_smtpad_id: "pad-top", pcb_port_id: "top" } },
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["net", "bottom"], circuitJsonMetadata: { pcb_smtpad_id: "pad-bottom", pcb_port_id: "bottom" } },
      { type: "rect", center: { x: 2, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["net", "far"], circuitJsonMetadata: { pcb_smtpad_id: "pad-far", pcb_port_id: "far" } },
    ],
  }
  const before = JSON.stringify(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null, effort: 1, experimentLayerAwareMstIdentity: true, experimentRelativeWitnessRepair: true })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimplifiedPcbTraces()
  const transition = output.find((trace) => trace.connectsTo?.includes("top") && trace.connectsTo?.includes("bottom"))
  expect(transition).toBeDefined()
  if (!transition) throw new Error("Layer-distinct connection was lost")
  const vias = transition.route.filter((point) => point.route_type === "via")
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.from_layer).not.toBe(via.to_layer)
    expect(Math.abs(via.x) > 0.2 || Math.abs(via.y) > 0.2).toBe(true)
  }
  const evaluated = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: output })
  expect(evaluated.errors).toEqual([])
  expect(checkViasInPads(evaluated.circuitJson)).toEqual([])
  expect(solver.netToPointPairsSolver?.layerAwareMstStats?.missingLayerKeys).toBe(0)
  expect(solver.relativeWitnessRepairSolver?.qualification).toMatchObject({ status: "NO_PROPOSAL", localRepaired: false, accepted: false, initialFullCertificateStatus: "PASS", finalFullCertificateStatus: "PASS", afterGeometryFindings: 0 })
  expect(solver.relativeWitnessRepairSolver?.getOutput()).toEqual(output)
  expect(solver.netToPointPairsSolver?.layerAwareMstStats).toMatchObject({ completed: true, inputDistinctLayerKeys: 3, mstCoveredLayerKeys: 3, missingLayerKeys: 0, zeroDistanceLayerEdges: 1 })
  expect(JSON.stringify(input)).toBe(before)
})
