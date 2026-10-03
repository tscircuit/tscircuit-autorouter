import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/muse-eink-via-copper-clearance/muse-eink-via-copper-clearance.srj.json" with {
  type: "json",
}

type RoutedVia = {
  x: number
  y: number
  diameter: number
  holeDiameter: number
  connectionName: string
}

type ViaCopperClearanceViolation = {
  a: RoutedVia
  b: RoutedVia
  gap: number
}

// Characterizes the reported bug. Set MUSE_EINK_REQUIRE_DRC_CLEAN=1 to
// assert the desired fixed behavior instead; that command currently fails.
test("Pipeline9 reports solved with insufficient Muse e-paper via copper clearance", (): void => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const minimumCopperGap = input.minTraceToPadEdgeClearance
  if (typeof minimumCopperGap !== "number") {
    throw new Error("Captured input must declare its copper clearance")
  }
  expect(input.minViaHoleDiameter).toBe(0.3)
  expect(input.minViaPadDiameter).toBe(0.5)
  expect(minimumCopperGap).toBe(0.15)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias: RoutedVia[] = []
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      if (
        typeof point.via_diameter !== "number" ||
        typeof point.via_hole_diameter !== "number"
      ) {
        throw new Error("Routed via must declare its physical diameters")
      }
      expect(point.via_diameter).toBe(0.5)
      expect(point.via_hole_diameter).toBe(0.3)
      // Shared endpoints may appear in more than one branch of the same net.
      if (
        vias.some(
          (via) =>
            via.connectionName === trace.connection_name &&
            Math.hypot(via.x - point.x, via.y - point.y) < 1e-9,
        )
      ) continue
      vias.push({
        x: point.x,
        y: point.y,
        diameter: point.via_diameter,
        holeDiameter: point.via_hole_diameter,
        connectionName: trace.connection_name,
      })
    }
  }

  const violations: ViaCopperClearanceViolation[] = []
  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const a = vias[i]!
      const b = vias[j]!
      if (a.connectionName === b.connectionName) continue
      const gap = Math.hypot(a.x - b.x, a.y - b.y) -
        (a.diameter + b.diameter) / 2
      if (gap < minimumCopperGap - 1e-9) violations.push({ a, b, gap })
    }
  }

  if (process.env.MUSE_EINK_REQUIRE_DRC_CLEAN === "1") {
    expect(violations).toEqual([])
  } else {
    expect(traces).toHaveLength(108)
    expect(vias).toHaveLength(92)
    expect(violations).toHaveLength(1)
    const violation = violations[0]!
    expect(new Set([violation.a.connectionName, violation.b.connectionName]))
      .toEqual(new Set(["source_net_2", "source_net_1"]))
    expect(violation.gap).toBeCloseTo(0.13541082528299198, 9)
    expect(violation.gap).toBeLessThan(minimumCopperGap)
  }
})
