import { expect, test } from "bun:test"
import { TestPointSolver } from "../../lib/solvers/TestPointSolver/TestPointSolver"
import type { SimpleRouteJson } from "../../lib/types"
import input from "./fixtures/astra-pd-power-supply.srj.json"

test("rejects invalid parameters, missing traces, and duplicate names", () => {
  const request = { name: "TP", pcbTraceId: "source_net_33_mst0_0", layer: "bottom" as const, diameter: 1 }
  const options = { requests: [request], clearance: 0.2, minProbeSpacing: 2.54, maxDetour: 1 }
  for (const patch of [{ clearance: NaN }, { maxDetour: -1 }, { sampleStep: 0 },
    { requests: [request, request] }, { requests: [{ ...request, diameter: -1 }] },
    { requests: [{ ...request, pcbTraceId: "missing" }] }]) {
    expect(() => new TestPointSolver(input as SimpleRouteJson, { ...options, ...patch })).toThrow()
  }
})
