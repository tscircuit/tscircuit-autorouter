import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { measurePostRoutingMetrics } from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import { restorePostRoutingPadMetadata } from "lib/utils/restorePostRoutingPadMetadata"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type SavedReplay = {
  inputHash: string
  sourceHash: string
  referenceHash: string
  referenceTraces: SimplifiedPcbTrace[]
  wholeNetConnections: SimpleRouteJson["connections"]
  nativePointPairConnections: SimpleRouteJson["connections"]
  traceOwners: [string, string][]
  arms: {
    arm: string
    replacements: SimplifiedPcbTrace[]
    traceOrder: string[]
    outputHash: string
    metrics: { viaSites: number; copperLength: number; bends: number }
    changedNets: string[]
  }[]
}

function copperHash(value: unknown): string {
  const serialized = JSON.stringify(value)
  return createHash("sha256").update(serialized).digest("hex")
}

test("public SRJ18 saved A/B/AB copper passes both gates and retains every unaffected trace exactly", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/srj18-post-routing/sample007-saved-replay.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as SavedReplay
  const { scenario } = await loadScenarioBySampleNumber("srj18", 7)
  const sourcePath = (
    scenario as SimpleRouteJson & { sourceCircuitJson: string }
  ).sourceCircuitJson
  const source = JSON.parse(
    await readFile(
      new URL(
        `../../node_modules/dataset-srj18/${sourcePath}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AnyCircuitElement[]
  expect(copperHash(scenario)).toBe(fixture.inputHash)
  expect(copperHash(source)).toBe(fixture.sourceHash)
  expect(copperHash(fixture.referenceTraces)).toBe(fixture.referenceHash)
  const physical = restorePostRoutingPadMetadata(
    createSrjWithBoardValidObstacleLayers(scenario),
    source,
  )
  physical.connections = fixture.wholeNetConnections
  const owners = new Map(fixture.traceOwners)
  expect(
    validatePostRoutingCandidate(physical, fixture.referenceTraces, owners)
      .valid,
  ).toBe(true)
  const reference = structuredClone(fixture.referenceTraces)
  for (const arm of fixture.arms) {
    const pool = new Map(reference.map((t) => [t.pcb_trace_id, t]))
    for (const trace of arm.replacements) pool.set(trace.pcb_trace_id, trace)
    const candidate = arm.traceOrder.map((id) => {
      const trace = pool.get(id)
      if (!trace) throw new Error(`Missing saved trace ${id}`)
      return trace
    })
    expect(copperHash(candidate)).toBe(arm.outputHash)
    expect(validatePostRoutingCandidate(physical, candidate, owners)).toEqual({
      valid: true,
      diagnostics: [],
    })
    expect(
      evaluateRelaxedDrc({
        inputSrj: scenario,
        srjWithPointPairs: {
          ...scenario,
          connections: fixture.nativePointPairConnections,
        },
        routedTraces: candidate,
      }).errors,
    ).toHaveLength(0)
    const metrics = measurePostRoutingMetrics(candidate, owners, physical)
    expect(metrics.viaSites).toBe(arm.metrics.viaSites)
    expect(metrics.copperLength).toBeCloseTo(arm.metrics.copperLength, 6)
    expect(metrics.bends).toBe(arm.metrics.bends)
    const retained = (traces: SimplifiedPcbTrace[]): SimplifiedPcbTrace[] =>
      traces.filter(
        (t) => !arm.changedNets.includes(owners.get(t.connection_name)!),
      )
    expect(retained(candidate)).toEqual(retained(reference))
  }
  expect(fixture.referenceTraces).toEqual(reference)
  expect(copperHash(scenario)).toBe(fixture.inputHash)
})
