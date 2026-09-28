import { expect, test } from "bun:test"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { validateExpandedPair } from "../../scripts/differential-pair-portfolio/validateExpandedPair"

test("rejects width reduction hidden in per-point metadata", (): void => {
  const params: PostProcessingSolverParams = {
    hdRoutes: [0, 1].map((i) => ({
      connectionName: `net${i}`,
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: i, z: 0 },
        { x: 10, y: i, z: 0 },
      ],
      vias: [],
    })),
    differentialPairs: [
      { connectionNames: ["net0", "net1"], lengthTolerance: 0.05 },
    ],
    obstacles: [],
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 3 },
    layerCount: 2,
  }
  const candidate = structuredClone(params.hdRoutes)
  candidate[0]!.route[0] = { ...candidate[0]!.route[0]!, traceThickness: 0.05 }
  const result = validateExpandedPair({ params, candidateHdRoutes: candidate })
  expect(result.status).toBe("invalid")
  expect(result.issues.some((issue) => issue.code === "copper-metadata")).toBe(
    true,
  )
})
