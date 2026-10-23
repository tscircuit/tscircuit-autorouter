import { expect, test } from "bun:test"
import type { Bounds } from "@tscircuit/repair04"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { migrateLegacyObstacleCircuitJsonMetadata } from "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type RegionProbe = {
  state: {
    phase: string
    negotiation?: { region: { bounds: Bounds } }
  }
}

test("regional contact crops are invariant to adding or renaming pad provenance", (): void => {
  const crops: Bounds[] = []
  const contactCenters: Array<{ x: number; y: number }> = []
  const padIds: string[] = []
  for (const provenance of ["legacy", "migrated", "renamed"] as const) {
    const fixture = createBoundedRegionalRepairFixture()
    const pad = fixture.originalSrj.obstacles[2]!
    pad.center = { x: 0.7, y: 0.14 }
    pad.width = 1.2
    pad.height = 0.4
    pad.connectedTo = [
      "pcb_smtpad_foreign",
      "pcb_smtpad_foreign",
      "pcb_port_foreign",
    ]
    delete pad.circuitJsonMetadata
    fixture.originalSrj.connections.push({
      name: "foreign",
      pointsToConnect: [
        { x: 0.7, y: 0.14, layer: "top", pcb_port_id: "pcb_port_foreign" },
        { x: 0.7, y: 4, layer: "top", pcb_port_id: "pcb_port_far" },
      ],
    })
    if (provenance !== "legacy") {
      fixture.originalSrj.obstacles =
        migrateLegacyObstacleCircuitJsonMetadata(
          fixture.originalSrj,
        ).obstacles
      if (provenance === "renamed") {
        fixture.originalSrj.obstacles[2]!.circuitJsonMetadata!.pcb_smtpad_id =
          "renamed_foreign_pad"
      }
    }
    const reference = fixture.drcEvaluator({
      traces: [],
      routes: fixture.routes,
    })
    if (Array.isArray(reference)) throw new Error("Expected centered reference")
    expect(reference.errors).toHaveLength(1)
    const error = reference.errors[0] as {
      center: { x: number; y: number }
      pcb_trace_error_id: string
    }
    contactCenters.push(error.center)
    padIds.push(error.pcb_trace_error_id)
    expect(error.center).not.toEqual(pad.center)

    const solver = new Pipeline9BoundedRegionalRepairSolver({
      ...fixture,
      budget: {
        maxRegions: 1,
        maxCandidateAttempts: 1,
        maxPathSearchNodes: 5000,
      },
    })
    const probe = solver as unknown as RegionProbe
    while (
      !solver.solved &&
      !solver.failed &&
      probe.state.phase !== "negotiate"
    )
      solver.step()
    expect(solver.error).toBeNull()
    expect(probe.state.phase).toBe("negotiate")
    if (!probe.state.negotiation) throw new Error("Expected a repair region")
    crops.push(probe.state.negotiation.region.bounds)
  }
  expect(new Set(padIds).size).toBe(3)
  expect(contactCenters[1]).toEqual(contactCenters[0])
  expect(contactCenters[2]).toEqual(contactCenters[0])
  expect(crops[1]).toEqual(crops[0])
  expect(crops[2]).toEqual(crops[0])
  expect((crops[0]!.minX + crops[0]!.maxX) / 2).toBeCloseTo(
    contactCenters[0]!.x,
    12,
  )
  expect((crops[0]!.minY + crops[0]!.maxY) / 2).toBeCloseTo(
    contactCenters[0]!.y,
    12,
  )
})
