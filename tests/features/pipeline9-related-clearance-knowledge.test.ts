import { expect, test } from "bun:test"
import { FindClearancePathSolver as ReferenceSolver, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver, type ClearanceSearchKnowledge } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/FindClearancePathSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("related clearance searches reuse hard feasibility while recomputing movable congestion and geometry revisions", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const route = fixture.routes[0]!
  const knowledge: ClearanceSearchKnowledge = { edges: new Map(), hits: 0, misses: 0, searches: 0, relatedSearchHits: 0 }
  let firstHits = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const srj = { ...fixture.originalSrj, traces: undefined }
    if (attempt === 2) srj.obstacles = [...srj.obstacles, { type: "rect", center: { x: -1, y: -0.5 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["new_barrier"] }]
    const input: ClearancePathInput = {
      srj, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route.at(-1)!, bounds: srj.bounds,
      traceThickness: route.traceThickness, traceClearance: 0.1, viaClearance: 0.1,
      allowLayerChanges: false, maxNodes: 10000,
      getAdditionalEdgeCost: (a, b): number => attempt === 0 ? 0 : Math.max(a.y, b.y) > 0 ? Infinity : 0,
    }
    const solver = new FindClearancePathSolver({ ...input, clearanceKnowledge: knowledge, clearanceKnowledgeContext: attempt === 2 ? "revision-1" : "revision-0" })
    const reference = new ReferenceSolver(input)
    solver.solve()
    reference.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.getOutput()).toEqual(reference.getOutput())
    expect(solver.stats).toEqual(reference.stats)
    if (attempt === 0) firstHits = knowledge.hits
    if (attempt === 1) expect(knowledge.hits).toBeGreaterThan(firstHits)
  }
  expect(knowledge.relatedSearchHits).toBeGreaterThan(0)
  expect(knowledge.misses).toBeGreaterThan(0)
  expect(knowledge.edges.size).toBeLessThanOrEqual(65536)
})
