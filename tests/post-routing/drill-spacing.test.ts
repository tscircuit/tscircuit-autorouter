import { expect, test } from "bun:test"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { boardFixture, wireTrace } from "./fixtures"

test("whole-board validation enforces same-net drill spacing and original via dimensions", () => {
  for (const defect of ["spacing", "diameter", "hole"] as const) {
    const input = boardFixture()
    input.srj.obstacles = []
    const end = defect === "spacing" ? 3.4 : 8
    const trace = wireTrace("vias", "signal-pair", [
      [0, 0],
      [3, 0],
    ])
    trace.route.push(
      {
        route_type: "via",
        x: 3,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: defect === "diameter" ? 0.4 : 0.6,
        via_hole_diameter: defect === "hole" ? 0.2 : 0.3,
      },
      { route_type: "wire", x: 3, y: 0, width: 0.4, layer: "bottom" },
      { route_type: "wire", x: end, y: 0, width: 0.4, layer: "bottom" },
      {
        route_type: "via",
        x: end,
        y: 0,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      { route_type: "wire", x: end, y: 0, width: 0.4, layer: "top" },
      { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "top" },
    )
    input.traces[0] = trace
    const checked = validatePostRoutingCandidate(
      input.srj,
      input.traces,
      input.traceOwners,
    )
    expect(checked.valid).toBe(false)
    expect(checked.diagnostics.join(" ")).toContain(
      defect === "spacing" ? "Drill spacing" : "Via dimensions",
    )
  }
})
