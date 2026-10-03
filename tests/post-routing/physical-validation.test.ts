import { expect, test } from "bun:test"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { boardFixture, wireTrace } from "./fixtures"

test("whole-board validation catches clearance, width, connectivity, edge and malformed transition failures", () => {
  for (const defect of [
    "short",
    "width",
    "open",
    "edge",
    "transition",
    "duplicate",
  ] as const) {
    const input = boardFixture()
    if (defect === "short")
      input.traces[0] = wireTrace("bad", "signal-pair", [
        [0, 0],
        [5, -2],
        [10, 0],
      ])
    if (defect === "width")
      input.traces[0] = wireTrace(
        "bad",
        "signal-pair",
        [
          [0, 0],
          [10, 0],
        ],
        0.1,
      )
    if (defect === "open")
      input.traces[0] = wireTrace("bad", "signal-pair", [
        [0, 0],
        [8, 0],
      ])
    if (defect === "edge")
      input.traces[0] = wireTrace("bad", "signal-pair", [
        [0, 0],
        [-2.9, 1],
        [10, 0],
      ])
    if (defect === "transition")
      input.traces[0]!.route.push({
        route_type: "wire",
        x: 10,
        y: 0,
        layer: "bottom",
        width: 0.4,
      })
    if (defect === "duplicate")
      input.traces.push(structuredClone(input.traces[0]!))
    const result = validatePostRoutingCandidate(
      input.srj,
      input.traces,
      input.traceOwners,
    )
    expect(result.valid).toBe(false)
    expect(result.diagnostics.join(" ")).toContain(
      {
        short: "Foreign copper clearance",
        width: "Trace width",
        open: "Disconnected",
        edge: "Board edge",
        transition: "Missing layer-transition",
        duplicate: "Duplicate trace",
      }[defect],
    )
  }
})
