/**
 * Repro: SameNetViaMergerSolver leaves a phantom copper "stub" when consolidating
 * overlapping same-net vias.
 *
 * When two same-net vias overlap, the merger relocates one via onto the other
 * (correct). But `moveViaTo` does this by *inserting* a detour to the kept via's
 * location into the route geometry without ever removing the original via point.
 * The result is a there-and-back copper stub on BOTH layers: the trace runs from
 * the kept location out to the removed via's old location and back. The `route.vias`
 * list looks clean (it points at the kept location), which hides the extra copper.
 *
 * This stub is NOT cleaned up by the downstream path_simplification stage — it
 * survives into the final routed output (verified separately via
 * TraceSimplificationSolver). It is same-net copper, so it is not a net-to-net
 * short, but it is spurious/dangling copper (stub → antenna/reflection,
 * manufacturing) and means the output geometry does not match the intended route.
 *
 * Per "no failing tests on merge", this test asserts the CURRENT (buggy) behavior:
 * the merge ADDS same-layer copper that did not exist in the input. A merge that
 * only relocates a via must not change copper length. When the bug is fixed,
 * `addedCopper` should be ~0 and the inverted assertion below should be used.
 *
 * To run: bun test tests/repro/same-net-via-merger-phantom-copper-stub.test.ts
 */
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

// Total length of same-layer (copper) trace segments in a route. Layer changes
// (z transitions, i.e. vias) are excluded — only physical copper is measured.
const copperLength = (route: HighDensityRoute) => {
  let length = 0
  for (let i = 0; i < route.route.length - 1; i++) {
    const a = route.route[i]
    const b = route.route[i + 1]
    if (a.z === b.z) length += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return length
}

test("repro: SameNetViaMergerSolver adds phantom copper when merging overlapping same-net vias", () => {
  // Two real traces on the same net (empty connMap => net "" for both). Each goes
  // along z0, vias to z1, and continues. Their vias sit 0.2mm apart, which is less
  // than the 0.3mm via diameter, so they overlap and must be consolidated.
  const inputHdRoutes: HighDensityRoute[] = [
    {
      connectionName: "ra",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 5.0, y: 0, z: 0 },
        { x: 5.0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
      vias: [{ x: 5.0, y: 0 }],
    },
    {
      connectionName: "rb",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0.5, z: 0 },
        { x: 5.2, y: 0, z: 0 },
        { x: 5.2, y: 0, z: 1 },
        { x: 10, y: 0.5, z: 1 },
      ],
      vias: [{ x: 5.2, y: 0 }],
    },
  ]

  const copperBefore = inputHdRoutes.reduce((n, r) => n + copperLength(r), 0)

  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({}),
  })
  solver.solve()

  expect(solver.failed).toBe(false)

  const merged = solver.getMergedViaHdRoutes()
  expect(merged).not.toBeNull()

  // The vias are correctly consolidated to a single location (this part works).
  const allVias = merged!.flatMap((r) => r.vias)
  const uniqueViaLocations = new Set(allVias.map((v) => `${v.x}:${v.y}`))
  expect(uniqueViaLocations.size).toBe(1)

  const copperAfter = merged!.reduce((n, r) => n + copperLength(r), 0)
  const addedCopper = copperAfter - copperBefore

  // BUG: a pure via relocation must not add copper, but it does. The detour stub
  // out to the removed via's old location (and back) adds same-layer copper on
  // both layers. We assert the current (buggy) positive value to keep CI green
  // and document the defect.
  //
  // When fixed, replace the two assertions below with:
  //   expect(addedCopper).toBeLessThan(1e-9)
  expect(addedCopper).toBeGreaterThan(0.1)

  // The merged route still physically visits the removed via's old location (5.2,0)
  // even though no via remains there — that is the dangling stub.
  const visitsOldViaLocation = merged!.some((r) =>
    r.route.some((p) => Math.hypot(p.x - 5.2, p.y - 0) < 1e-6),
  )
  expect(visitsOldViaLocation).toBe(true)
})
