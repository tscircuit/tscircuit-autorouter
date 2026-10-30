import type { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"

type NativeInput = ConstructorParameters<typeof HighDensityForceImproveSolver>[0]
export type SparseForceRoute = NativeInput["hdRoutes"][number]
export type SparseForceCase = { name: string; routes: SparseForceRoute[] }

export const createSparseForceDifferentialCases = (): SparseForceCase[] => {
  const route = (name: string, points: number[][]): SparseForceRoute => ({
    connectionName: name,
    rootConnectionName: name,
    regionId: "sample",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: points.map(([x, y, z = 0], index) => ({
      x, y, z, ...(index === 0 ? { insideJumperPad: true } : {}),
    })),
    vias: [],
  })
  const cases: SparseForceCase[] = [
    { name: "fixed-two", routes: [route("a", [[1, 5], [9, 5]])] },
    { name: "fixed-four-bent", routes: [route("a", [[1, 1], [1, 4], [9, 4], [9, 9]])] },
    { name: "fixed-off-grid-outside", routes: [route("a", [[-0.1, 5.00004], [9.234567, 5.00004]])] },
    { name: "fixed-protected-via", routes: [route("a", [[0, 1, 0], [0, 1, 1], [9, 8, 1], [9, 9, 1]])] },
    { name: "fixed-long-coincident", routes: [route("a", [[1, 1], [1, 1], [1, 1, 1], [1, 1, 1], [9, 9, 1]])] },
    { name: "mobile-clean", routes: [route("a", [[1, 1], [2, 1], [3, 2], [6, 3], [8, 2], [9, 2]])] },
    { name: "mobile-collinear", routes: [route("a", [[1, 5], [2, 5], [3, 5], [8, 5], [9, 5]])] },
    { name: "live-overlap-seed", routes: [route("a", [[1, 5], [2, 5], [5, 5], [8, 5], [9, 5]]), route("b", [[1, 5], [9, 5]])] },
    { name: "mixed-fixed-free", routes: [route("a", [[1, 2], [9, 2]]), route("b", [[1, 2.1], [9, 2.1]]), route("c", [[1, 7], [2, 7], [3, 8], [6, 7], [8, 8], [9, 8]])] },
    { name: "moving-via-crossing", routes: [route("a", [[1, 4], [2, 4], [5, 5], [5, 5, 1], [8, 6, 1], [9, 6, 1]]), route("b", [[5, 1], [5, 9]])] },
    { name: "layer-separated", routes: [route("a", [[1, 5], [2, 5], [5, 5], [8, 5], [9, 5]]), route("b", [[5, 1, 1], [5, 9, 1]])] },
    { name: "signed-zero-bounds", routes: [route("a", [[0, -0], [1, -0], [3, -0], [8, -0], [9, -0]])] },
  ]
  let seed = 12731
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let index = 0; index < 36; index++) {
    const routes: SparseForceRoute[] = []
    for (let r = 0; r < 1 + index % 4; r++) {
      const points: number[][] = []
      for (let p = 0; p < 2 + (index + r) % 7; p++) {
        points.push([Math.round(next() * 10000) / 1000, Math.round(next() * 10000) / 1000, r % 2])
      }
      const item = route(`r${r}`, points)
      if (index % 3 === 0) item.rootConnectionName = "shared-root"
      routes.push(item)
    }
    cases.push({ name: `seeded-${index}`, routes })
  }
  return cases
}
