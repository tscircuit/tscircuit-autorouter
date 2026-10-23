import { expect, test } from "bun:test"
import { selectPipeline9RepairProgress } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectPipeline9RepairProgress"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("lower reference DRC cannot retain a new foreign-pad via contact", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0, y: 2 },
    width: 0.5,
    height: 0.5,
    layers: ["bottom"],
    connectedTo: ["pcb_smtpad_foreign_via"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign_via" },
  })
  const candidate: HighDensityRoute[] = [
    {
      ...fixture.routes[0]!,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: -2, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 2, z: 1 },
        { x: 0, y: 2, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      vias: [{ x: 0, y: 2 }],
    },
  ]
  const candidateReference = fixture.drcEvaluator({
    traces: [],
    routes: candidate,
    hdRoutes: candidate,
  })
  if (Array.isArray(candidateReference)) {
    expect(candidateReference).toHaveLength(0)
  } else {
    expect(candidateReference.errors).toHaveLength(0)
  }

  const result = selectPipeline9RepairProgress({
    originalSrj: fixture.originalSrj,
    originalRoutes: fixture.routes,
    candidates: [candidate],
    drcEvaluator: fixture.drcEvaluator,
  })
  expect(result.routes).toBe(fixture.routes)
  expect(result.drcIssueCount).toBeGreaterThan(0)
})
