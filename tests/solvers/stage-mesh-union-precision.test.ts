import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { BooleanOperations, Polygon, point } from "@flatten-js/core"
import { canonicalizeMeshRing } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"

test("uniform proposal precision resolves the valid real capsule-arc union without a solver retry", (): void => {
  const pair = JSON.parse(readFileSync(new URL("../fixtures/mesh-union-ulp-pair.json", import.meta.url), "utf8"))
  const bounds = { minX: -20, maxX: 20, minY: -20, maxY: 20 }
  for (const scale of [1, 10, 100, 1000, 10000, 100000, 1000000]) {
    const left = new Polygon(pair.left.map((ring: any[]) => canonicalizeMeshRing(ring, bounds).map((p) => point(p.x * scale, p.y * scale))))
    const right = new Polygon(canonicalizeMeshRing(pair.right, bounds).map((p) => point(p.x * scale, p.y * scale)))
    expect(left.isValid()).toBe(true)
    expect(right.isValid()).toBe(true)
    const union = BooleanOperations.unify(left, right)
    expect(union.faces.size).toBe(1)
    expect(union.area()).toBeGreaterThanOrEqual(Math.max(left.area(), right.area()) - scale ** 2 * 1e-8)
    expect(union.area()).toBeLessThanOrEqual(left.area() + right.area() + scale ** 2 * 1e-8)
  }
})
