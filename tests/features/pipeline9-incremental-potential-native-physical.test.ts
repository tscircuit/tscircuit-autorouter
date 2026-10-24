import { expect, test } from "bun:test"
import { FindClearancePathSolver as Native, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/FindClearancePathSolver"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotentials } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("warm relaxed fields preserve native full-segment physical checks and exact route anchors", () => {
  const route = { connectionName: "wire", rootConnectionName: "own", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -3, y: 0, z: 0, pcb_port_id: "start" }, { x: 3, y: 0, z: 0, pcb_port_id: "end" }], vias: [] }
  const input: ClearancePathInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, connections: [], obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.8, height: 5.8, layers: ["top"], connectedTo: ["foreign"] }] }, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!, bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, gridSize: 0.2, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, allowLayerChanges: false, maxNodes: 30000, heuristicWeight: 3 }
  const work = new IncrementalRepairWorkBudget(1000000)
  const retained = new RetainedHardSpacePotentials(work)
  for (let repetition = 0; repetition < 3; repetition++) {
    const solver = new FindClearancePathSolver(input, retained)
    solver.solve()
    const path = solver.getOutput()
    expect(path).not.toBe(null)
    expect(path![0]).toEqual(input.start)
    expect(path!.at(-1)).toEqual(input.end)
    expect(path!.every((point) => point.z === 0)).toBe(true)
    const validator = new Native({ ...input, existingPath: path!, maxNodes: 1 })
    validator.solve()
    expect(validator.getOutput()).toEqual(path)
    expect(validator.stats.nodesPopped).toBe(0)
  }
  expect(work.counters.workspaceHits).toBe(2)
  expect(work.counters.blockedEdgeObservations).toBeGreaterThan(0)
})
