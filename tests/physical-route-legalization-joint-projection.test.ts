import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  legalizeHighDensityRouteProposal,
  type PhysicalRouteLegalizationParams,
} from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"

test("joint physical projection preserves active pad and drill constraints while permitting useful descent", () => {
  // Reduced from dataset24 sample11's captured cmn_3 proposal. Four separate
  // projection passes could not produce even one accepted energy-decreasing step.
  const params = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/physical-route-legalization-joint-projection.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as PhysicalRouteLegalizationParams
  const original = structuredClone(params)
  const result = legalizeHighDensityRouteProposal(params)
  if (
    result.lossBefore === null ||
    result.lossAfter === null ||
    result.holePairsBefore === null ||
    result.holePairsAfter === null
  )
    throw new Error("Physical fixture must record energy and drill counts")
  if (!original.obstacles || original.obstacles.length !== 4)
    throw new Error("Fixture must include its four coupled pads")
  expect(result.iterations).toBe(1)
  expect(result.lossAfter).toBeLessThan(result.lossBefore * 0.9)
  expect(result.status).toBe("improved-needs-repair")
  expect(result.holePairsAfter).toBe(0)
  expect(result.holePairsAfter).toBeLessThanOrEqual(result.holePairsBefore)
  expect(result.overlapPairsAfter).toBeLessThanOrEqual(
    result.overlapPairsBefore!,
  )
  expect(result.obstacleGuardRejected).toBe(false)
  expect(result.boardGuardRejected).toBe(false)
  const beforeVia = original.routes[0]!.vias[0]!,
    afterVia = result.routes[0]!.vias[0]!
  const peer = result.routes[2]!.vias[0]!
  expect(peer).toEqual(original.routes[2]!.vias[0]!)
  expect(
    Math.hypot(afterVia.x - peer.x, afterVia.y - peer.y),
  ).toBeGreaterThanOrEqual(0.25 - 1e-8)
  for (const pad of original.obstacles) {
    const beforeDistance = Math.hypot(
      Math.max(0, Math.abs(beforeVia.x - pad.center.x) - pad.width / 2),
      Math.max(0, Math.abs(beforeVia.y - pad.center.y) - pad.height / 2),
    )
    const afterDistance = Math.hypot(
      Math.max(0, Math.abs(afterVia.x - pad.center.x) - pad.width / 2),
      Math.max(0, Math.abs(afterVia.y - pad.center.y) - pad.height / 2),
    )
    expect(afterDistance).toBeGreaterThanOrEqual(beforeDistance - 1e-8)
  }
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original.routes[index]!.route[0]!)
    expect(route.route.at(-1)).toEqual(original.routes[index]!.route.at(-1)!)
  }
  expect(params).toEqual(original)
})
