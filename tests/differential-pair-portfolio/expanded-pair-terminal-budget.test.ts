import { expect, test } from "bun:test"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { validateExpandedPair } from "../../scripts/differential-pair-portfolio/validateExpandedPair"

test("measures terminal escape separately from interior uncoupling", (): void => {
  const params: PostProcessingSolverParams = {
    hdRoutes: [0, 1].map((i) => ({
      connectionName: `net${i}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: i * 0.3, z: 0 },
        { x: 2, y: i * 0.3, z: 0 },
        { x: 3, y: 1 + i * 0.3, z: 0 },
        { x: 4, y: 1 + i * 0.3, z: 0 },
        { x: 5, y: i * 0.3, z: 0 },
        { x: 10, y: i * 0.3, z: 0 },
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
  const result = validateExpandedPair({
    params,
    candidateHdRoutes: structuredClone(params.hdRoutes),
    constraints: [
      {
        connectionNames: ["net0", "net1"],
        traceGap: 0.2,
        maxUncoupledLength: 0.2,
      },
    ],
  })
  expect(result.issues.some((i) => i.code === "uncoupled-length")).toBe(false)
  expect(result.pairs[0]!.uncoupledMm![0]).toBeGreaterThan(0.2)
  expect(result.pairs[0]!.terminalUncoupledMm).toEqual([
    [0, 0],
    [0, 0],
  ])
})
