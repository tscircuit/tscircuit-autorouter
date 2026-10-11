import { expect, test } from "bun:test"
import { CompletedFirstValidA13Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/CompletedFirstValidA13Solver"
import { executeFirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import { validateFirstValidHighDensityRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/validateFirstValidHighDensityRoutes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("first-valid A13 preserves full physical widths and terminals while rejecting unsafe candidates", (): void => {
  const node = createFirstValidNode()
  node.portPoints = node.portPoints.map((point, index) => ({ ...point, pcb_port_id: `physical_terminal_${index}` }))
  const job: FirstValidA13CandidateJob = { kind: "firstValidA13Candidate",
    params: { nodeWithPortPoints: node, traceWidth: 0.2, viaDiameter: 0.4, layerCount: 2,
      effort: 0.25, obstacles: [], enableNegotiatedSearch: true,
      boardGeometry: { bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, minBoardEdgeClearance: 0.2 } },
    connectivityNetMap: { signal_root: ["signal_root", "signal"] },
    connectivityIdToNetMap: { signal: "signal_root", signal_root: "signal_root" } }
  const originalJob = structuredClone(job)
  const result = executeFirstValidA13CandidateJob(job)
  expect(result.status).toBe("solved")
  if (result.status !== "solved") throw new Error(`Expected safe physical routing, got ${result.status}`)
  expect(result.routes).toHaveLength(1)
  const route = result.routes[0]!
  expect(route.traceThickness).toBe(0.2)
  expect(route.viaDiameter).toBe(0.4)
  expect(route.rootConnectionName).toBe("signal_root")
  expect(route.route[0]).toEqual(node.portPoints[0]!)
  expect(route.route.at(-1)).toEqual(node.portPoints[1]!)
  expect(result.routingIterations).toBeGreaterThan(0)
  const completed = new CompletedFirstValidA13Solver(node, result)
  expect(completed.solved).toBe(true)
  expect(completed.failed).toBe(false)
  expect(completed.solvedRoutes).toEqual(result.routes)
  expect(completed.routingIterations).toBe(result.routingIterations)
  expect(completed.iterations).toBe(result.iterations)
  expect(completed.stats).toEqual(result.sourceStats)
  expect(validateFirstValidHighDensityRoutes({ routes: completed.solvedRoutes, node, traceWidth: 0.2,
    viaDiameter: 0.4, obstacleMargin: 0.1, layerCount: 2, obstacles: [], boardGeometry: job.params.boardGeometry })).toEqual({ valid: true })
  expect(validateFirstValidHighDensityRoutes({ routes: completed.solvedRoutes, node, traceWidth: 0.21,
    viaDiameter: 0.4, obstacleMargin: 0.1, layerCount: 2, obstacles: [] })).toEqual({ valid: false, reason: "trace-width" })
  expect(job).toEqual(originalJob)

  const unsafeJobs: FirstValidA13CandidateJob[] = [
    { ...job, params: { ...job.params, obstacles: [{ type: "rect", center: { x: 0, y: 0 },
      width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["pcb_port_foreign"],
      circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign", pcb_port_id: "pcb_port_foreign" } }] } },
    { ...job, params: { ...job.params, obstacles: [{ type: "rect", center: { x: 0, y: 0.219 },
      width: 0.5, height: 0.04, layers: ["top"], connectedTo: [] }] } },
    { ...job, params: { ...job.params, boardGeometry: { bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } } } },
  ]
  for (const unsafeJob of unsafeJobs) {
    const rejected = executeFirstValidA13CandidateJob(unsafeJob)
    expect(rejected.status).toBe("failed")
    if (rejected.status !== "failed") throw new Error(`Expected physical rejection, got ${rejected.status}`)
    expect(rejected.error).toContain("board copper validation")
    expect(rejected.sourceStats.boardDrcIssueCount).toBeGreaterThan(0)
    expect(() => new CompletedFirstValidA13Solver(node, rejected)).toThrow("status failed")
  }
  const tighterClearanceObstacle = { type: "rect" as const, center: { x: 0, y: 0.221 },
    width: 0.5, height: 0.04, layers: ["top"], connectedTo: [] }
  const provisional = executeFirstValidA13CandidateJob({ ...job,
    params: { ...job.params, obstacles: [tighterClearanceObstacle] } })
  expect(provisional.status).toBe("solved")
  if (provisional.status !== "solved") throw new Error(`Expected original 0.1 mm clearance, got ${provisional.status}`)
  expect(validateFirstValidHighDensityRoutes({ routes: provisional.routes, node, traceWidth: 0.2,
    viaDiameter: 0.4, obstacleMargin: 0.15, layerCount: 2,
    obstacles: [tighterClearanceObstacle], boardGeometry: job.params.boardGeometry })).toEqual({ valid: false, reason: "fixed-obstacle" })
  const collapsedNode = { ...node, portPoints: [
    { ...node.portPoints[0]!, x: -3, y: -3 }, { ...node.portPoints[1]!, x: -2.95, y: -3 },
  ] }
  const collapsed = executeFirstValidA13CandidateJob({ ...job, params: { ...job.params, nodeWithPortPoints: collapsedNode } })
  expect(collapsed).toMatchObject({ status: "failed", iterations: 0, routingIterations: 0,
    error: "Boundary clearance collapses distinct terminals" })
  expect(() => new CompletedFirstValidA13Solver(collapsedNode, collapsed)).toThrow("status failed")
})
