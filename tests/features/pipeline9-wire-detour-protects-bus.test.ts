import { expect, test } from "bun:test"
import { applyPipeline9IndependentWireDetours } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentWireDetours"
import { createWireDetourFixture } from "../fixtures/pipeline9-wire-detour-fixture"

test("independent detours leave matched bus wires unchanged", (): void => {
  const fixture = createWireDetourFixture()
  fixture.originalSrj.buses = [{ busId: "matched", connectionNames: ["signal_0"] }]
  const result = applyPipeline9IndependentWireDetours({
    ...fixture,
    maxCandidateAttempts: 4,
    maxPathSearchNodes: 30000,
  })
  expect(result.routes).toBe(fixture.routes)
  expect(result.candidateAttempts).toBe(0)
  expect(result.pathSearchNodes).toBe(0)
})
