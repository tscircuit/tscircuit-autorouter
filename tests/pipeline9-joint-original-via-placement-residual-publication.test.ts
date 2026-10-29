import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateJointOriginalViaPlacement, makeJointOriginalViaPlacementFixture } from "./fixtures/pipeline9JointOriginalViaPlacement"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

test("a residual repair cannot publish a new physical via violation despite its reported zero findings", (): void => {
  const fixture = makeJointOriginalViaPlacementFixture("board")
  const illegalCandidate = structuredClone(fixture.params.newHdRoutes)
  const legalInput = structuredClone(illegalCandidate)
  legalInput[0]!.route[2]!.y = 0.25
  legalInput[0]!.route[3]!.y = 0.25
  legalInput[0]!.vias[0]!.y = 0.25
  const crossingConnections: SimpleRouteConnection[] = [
    { name: "crossA", pointsToConnect: [{ x: -1, y: 1.3, layer: "inner1", pcb_port_id: "a1" }, { x: 1, y: 1.3, layer: "inner1", pcb_port_id: "a2" }] },
    { name: "crossB", pointsToConnect: [{ x: 0, y: 0.8, layer: "inner1", pcb_port_id: "b1" }, { x: 0, y: 1.8, layer: "inner1", pcb_port_id: "b2" }] },
  ]
  const crossingRoutes: HighDensityRoute[] = crossingConnections.map((connection) => ({
    connectionName: connection.name, rootConnectionName: connection.name,
    traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: connection.pointsToConnect.map((point) => ({ x: point.x, y: point.y, z: 1, pcb_port_id: point.pcb_port_id })),
  }))
  fixture.originalSrj.connections.push(...structuredClone(crossingConnections))
  fixture.srjWithPointPairs.connections.push(...structuredClone(crossingConnections))
  fixture.params.srj.connections.push(...structuredClone(crossingConnections))
  fixture.params.connMap = new ConnectivityMap({ signal: ["signal", "a", "b"], crossA: ["crossA", "a1", "a2"], crossB: ["crossB", "b1", "b2"] })
  legalInput.push(...crossingRoutes)
  illegalCandidate.push(...structuredClone(crossingRoutes))
  illegalCandidate[2]!.route.splice(1, 0, { x: 1.5, y: 0.8, z: 1 }, { x: 1.5, y: 1.8, z: 1 })
  fixture.params.newHdRoutes = legalInput
  const inputBefore = structuredClone(legalInput)
  expect(evaluateJointOriginalViaPlacement(fixture, legalInput).board).toEqual([])
  expect(evaluateJointOriginalViaPlacement(fixture, legalInput).reference.errors.length).toBeGreaterThan(0)
  const candidateChecks = evaluateJointOriginalViaPlacement(fixture, illegalCandidate)
  expect(candidateChecks.reference.errors).toEqual([])
  expect(candidateChecks.board).toHaveLength(1)
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, checkOriginalViaPlacement: true })
  expect(solver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  // Isolate the publication boundary while retaining the actual reference
  // converter and physical checkers installed by the Joint constructor.
  solver["boundedRegionalRepairSolver"] = {
    solved: true,
    getResult: () => ({ routes: illegalCandidate, publishedDrcIssueCount: 0 }),
  } as unknown as NonNullable<typeof solver["boundedRegionalRepairSolver"]>
  solver["regionalB01RepairSolver"] = {
    solved: true,
    getResult: () => ({ routes: illegalCandidate }),
  } as unknown as NonNullable<typeof solver["regionalB01RepairSolver"]>
  solver["boundedRegionalParams"] = {
    budget: getPipeline9BoundedRepairBudget(1, 0, 1),
  } as NonNullable<typeof solver["boundedRegionalParams"]>
  solver["boundedRegionalRepairStartedAt"] = 0
  solver["finishBoundedRegionalRepair"]()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("Pipeline9 joint repair retains 1 original via-placement violations")
  expect(solver["combinedOutput"]).toBeUndefined()
  expect(fixture.params.newHdRoutes).toEqual(inputBefore)
})
