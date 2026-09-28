import { expect, test } from "bun:test"
import { validateExpandedPair } from "../../scripts/differential-pair-portfolio/validateExpandedPair"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"

test("rejects equal-length clearance-safe copper that exceeds a declared coupling budget", (): void => {
  const params: PostProcessingSolverParams = {
    hdRoutes: [0, 1].map((i) => ({
      connectionName: `net${i}`,
      traceThickness: 0.1,
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
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
    layerCount: 2,
  }
  const result = validateExpandedPair({
    params,
    candidateHdRoutes: structuredClone(params.hdRoutes),
    constraints: [
      {
        connectionNames: ["net0", "net1"],
        traceGap: 0.2,
        maxUncoupledLength: 1,
      },
    ],
  })
  expect(result.status).toBe("invalid")
  expect(result.issues.some((i) => i.code === "uncoupled-length")).toBe(true)
  expect(result.pairs[0]!.skewMm).toBe(0)
  expect(result.pairs[0]!.uncoupledMm![0]).toBeCloseTo(10)
})
