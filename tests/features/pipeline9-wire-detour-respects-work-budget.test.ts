import { expect, test } from "bun:test"
import { applyPipeline9IndependentWireDetours } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentWireDetours"
import { createWireDetourFixture } from "../fixtures/pipeline9-wire-detour-fixture"

test("an exhausted detour search publishes nothing and respects its node limit", (): void => {
  const fixture = createWireDetourFixture()
  const result = applyPipeline9IndependentWireDetours({
    ...fixture,
    maxCandidateAttempts: 1,
    maxPathSearchNodes: 1,
  })
  expect(result.routes).toBe(fixture.routes)
  expect(result.candidateAttempts).toBeLessThanOrEqual(1)
  expect(result.pathSearchNodes).toBeLessThanOrEqual(1)
})
