import { expect, test } from "bun:test"
import { validateExpandedPair } from "../../scripts/differential-pair-portfolio/validateExpandedPair"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"

test("accepts continuous matched copper at its declared gap with immutable routes preserved", (): void => {
  const params: PostProcessingSolverParams = {
    hdRoutes: [0, 1, 2].map((i) => ({
      connectionName: `net${i}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: i === 2 ? 2 : i * 0.3, z: 0 },
        { x: 10, y: i === 2 ? 2 : i * 0.3, z: 0 },
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
  const result = validateExpandedPair({
    params,
    candidateHdRoutes: candidate,
    constraints: [
      {
        connectionNames: ["net0", "net1"],
        traceGap: 0.2,
        maxUncoupledLength: 1,
      },
    ],
  })
  expect(result.status).toBe("valid")
  expect(result.pairs[0]!.coupledFraction).toEqual([1, 1])
  candidate[2]!.route[1]!.y = 2.2
  expect(
    validateExpandedPair({ params, candidateHdRoutes: candidate }).issues.some(
      (i) => i.code === "immutable-copper",
    ),
  ).toBe(true)
})
