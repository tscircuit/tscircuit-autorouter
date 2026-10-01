import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { boardFixture, phaseOptions } from "./fixtures"

test("explicit final phase improves three generic boards and retains every unaffected byte and original rule", () => {
  for (const [offset, width] of [
    [0, 0.4],
    [17.25, 0.3],
    [-22.5, 0.6],
  ]) {
    const input = boardFixture(offset, width),
      original = structuredClone(input)
    const result = optimizePostRouting(input, phaseOptions())
    expect(result.status).toBe("accepted")
    expect(result.changedNets).toEqual(["signal"])
    expect(result.changes[0]!.removedTraceIds).toEqual(["old-signal"])
    expect(result.after!.copperLength).toBeLessThan(result.before!.copperLength)
    expect(result.after!.viaSites).toBe(0)
    expect(JSON.stringify(result.traces[0])).toBe(
      JSON.stringify(input.traces[1]),
    )
    expect(input).toEqual(original)
    for (const trace of result.traces.filter(
      (t) => t.connection_name === "signal",
    ))
      for (const p of trace.route)
        if (p.route_type === "wire") expect(p.width).toBe(width)
    const owners = new Map(input.traceOwners)
    owners.set("signal", "signal")
    expect(
      validatePostRoutingCandidate(input.srj, result.traces, owners).valid,
    ).toBe(true)
    expect(optimizePostRouting(input, phaseOptions()).traces).toEqual(
      result.traces,
    )
  }
})
