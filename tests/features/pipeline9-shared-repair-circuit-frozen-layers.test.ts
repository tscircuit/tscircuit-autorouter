import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput, type SharedRepairEvaluatorAccess } from "../fixtures/shared-repair-geometry-input"

const freezeLayersAndContext = (value: unknown): void => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) freezeLayersAndContext(nested)
  Object.freeze(value)
}

test("native and prepared Joint predicates preserve frozen multilayer ports, pad and hole context across every evaluator mode", (): void => {
  const solvers = [undefined, false, true].map((enabled) => {
    const params = createSharedRepairGeometryInput(enabled)
    for (const connection of params.originalSrj.connections) {
      for (const point of connection.pointsToConnect) {
        delete point.layer
        point.layers = ["top", "bottom"]
      }
    }
    params.originalSrj.obstacles[0]!.layers = ["top", "bottom"]
    params.originalSrj.obstacles[0]!.circuitJsonMetadata = {
      pcb_plated_hole_id: "frozen_plated_pad",
      pcb_port_id: "fixed_pad_owner",
    }
    params.originalSrj.obstacles.push({
      type: "rect",
      obstacleId: "frozen_hole",
      isNonPlatedHole: true,
      shape: "circle",
      center: { x: 5, y: 5 },
      width: 0.5,
      height: 0.5,
      layers: ["top", "bottom"],
      connectedTo: [],
    })
    freezeLayersAndContext(params.originalSrj)
    return new Pipeline9JointDrcRepairSolver(params)
  })
  const routes = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
  const original = structuredClone(routes)
  for (const mode of ["drcEvaluator", "cachedReferenceDrcEvaluator", "clearancePrecisionDrcEvaluator", "clearancePrecisionIndexedDrcEvaluator"] as const) {
    const values = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)[mode]({ traces: [], routes }))
    expect(values[1]).toEqual(values[0])
    expect(values[2]).toEqual(values[0])
  }
  const margin = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)
    .clearanceMarginDrcEvaluator(routes, [], original))
  expect(margin[1]).toEqual(margin[0])
  expect(margin[2]).toEqual(margin[0])
  for (const solver of solvers) solver.solve()
  expect(solvers[1]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.getOutput()).toEqual(solvers[0]!.getOutput())
  expect(solvers[2]!.sharedRepairCircuitStats!.contextBuilds).toBe(2)
})
