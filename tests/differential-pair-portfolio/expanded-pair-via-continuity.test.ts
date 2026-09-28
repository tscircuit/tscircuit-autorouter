import { expect, test } from "bun:test"
import { validateExpandedPair } from "../../scripts/differential-pair-portfolio/validateExpandedPair"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"

test("rejects a via whose layer transition moves in the plane without mutating the incumbent", (): void => {
  const params: PostProcessingSolverParams = {
    hdRoutes: [0, 1].map((i) => ({
      connectionName: `net${i}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: i * 0.3, z: 0 },
        { x: 10, y: i * 0.3, z: 0 },
      ],
      vias: [],
    })),
    differentialPairs: [
      { connectionNames: ["net0", "net1"], lengthTolerance: 0.05 },
    ],
    obstacles: [],
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
    layerCount: 2,
  }
  const incumbent = structuredClone(params)
  const candidate = structuredClone(params.hdRoutes)
  candidate[0]!.route.splice(
    1,
    0,
    { x: 3, y: 0, z: 0 },
    { x: 4, y: 0, z: 1 },
    { x: 8, y: 0, z: 1 },
    { x: 8, y: 0, z: 0 },
  )
  candidate[0]!.vias = [
    { x: 4, y: 0 },
    { x: 8, y: 0 },
  ]
  const result = validateExpandedPair({ params, candidateHdRoutes: candidate })
  expect(result.status).toBe("invalid")
  expect(result.issues.some((i) => i.code === "via-continuity")).toBe(true)
  expect(params).toEqual(incumbent)
})
