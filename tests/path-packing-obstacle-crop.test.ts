import { expect, test } from "bun:test"
import { PathPackingGeometry, createPathPackingAudit, preparePathPackingObstacles, type PackingGeometryParams } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { finishPackingGenerator, packingCrossingNode } from "./fixtures/pathPackingSynthetic"

test("actual obstacle crop preserves hole, via-pad and thick-wire exclusion beyond the region boundary", () => {
  const wire: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }
  const via: HighDensityRoute = { ...wire, route: [{ x: -2, y: 0, z: 0 }, { x: 1.8, y: 0, z: 0 },
    { x: 1.8, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }], vias: [{ x: 1.8, y: 0 }] }
  const pad: Obstacle = { type: "rect", center: { x: 2.6, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top", "bottom"], connectedTo: ["foreign"] }
  const base: PackingGeometryParams = { node: packingCrossingNode, obstacles: [], layerCount: 2,
    traceClearance: 0.1, holeClearance: 0.1, viaToPadClearance: 0.1,
    viaHoleDiameter: 0.15, minimumHoleGap: 0.1 }
  for (const fixture of [
    { route: wire, obstacle: { ...pad, isNonPlatedHole: true, shape: "circle" as const },
      params: { ...base, holeClearance: 1 } },
    { route: via, obstacle: pad, params: { ...base, viaToPadClearance: 1 } },
    { route: { ...wire, traceThickness: 0.5 }, obstacle: { ...pad, center: { x: 2.4, y: 0 } }, params: base },
  ]) {
    const { route, params } = fixture
    const original = [fixture.obstacle]
    const cropped = finishPackingGenerator(preparePathPackingObstacles(params.node, original,
      route.traceThickness, route.viaDiameter, Math.max(params.traceClearance, params.holeClearance, params.viaToPadClearance)))
    expect(cropped).toHaveLength(1)
    expect(cropped[0]).toBe(original[0])
    for (const obstacles of [original, cropped]) {
      const geometry = new PathPackingGeometry({ ...params, obstacles }, createPathPackingAudit())
      expect(finishPackingGenerator(geometry.unary(route, { connectionName: "a",
        points: [route.route[0]!, route.route.at(-1)!] }))).toBeFalse()
    }
  }
  expect(() => finishPackingGenerator(preparePathPackingObstacles(base.node, [pad], NaN, 0.3, 0.1))).toThrow("crop geometry")
})
