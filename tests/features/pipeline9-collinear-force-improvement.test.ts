import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { HighDensityRoute } from "lib/types/high-density-types"
import input from "../fixtures/am3352-force-improve-dense-grid.json"

test("AM3352 force improvement removes redundant grid points without changing copper paths", (): void => {
  const routes = input.hdRoutes as HighDensityRoute[]
  const simplified = simplifyPipeline9CollinearRoutePoints(routes)
  expect(routes.reduce((n, r) => n + r.route.length, 0)).toBe(4735)
  expect(simplified.reduce((n, r) => n + r.route.length, 0)).toBeLessThan(350)
  for (let index = 0; index < routes.length; index++) {
    const original = routes[index]!
    const result = simplified[index]!
    expect(result.route[0]).toEqual(original.route[0])
    expect(result.route.at(-1)).toEqual(original.route.at(-1))
    expect(result.vias).toEqual(original.vias)
    expect(result.traceThickness).toBe(original.traceThickness)
    expect(result.viaDiameter).toBe(original.viaDiameter)
    // Every original grid vertex must still lie on its routed copper layer.
    for (const p of original.route) {
      expect(
        result.route.some((a, j) => {
          const b = result.route[j + 1]
          if (!b || p.z !== a.z || p.z !== b.z) return false
          const dx = b.x - a.x,
            dy = b.y - a.y
          const lengthSquared = dx * dx + dy * dy
          const t =
            lengthSquared === 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    1,
                    ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared,
                  ),
                )
          return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 1e-8
        }),
      ).toBe(true)
    }
  }
  const solver = new HighDensityForceImproveSolver({
    ...input,
    hdRoutes: simplified,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toHaveLength(routes.length)
})
