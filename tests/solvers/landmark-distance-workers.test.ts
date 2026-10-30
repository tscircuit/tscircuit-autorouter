import { expect, test } from "bun:test"
import { LandmarkDistancePreparationSolver } from "tiny-hypergraph/lib/prepared/LandmarkDistancePreparationSolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("landmark workers account for a detour and preserve disconnected ports", async (): Promise<void> => {
  const input = {
    portX: [0, 0, 10, 10, 5],
    portY: [0, 10, 10, 0, 5],
    incidentPortRegion: [[0], [0, 1], [1, 2], [2], []],
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3]],
    landmark: 0,
  }
  const original = structuredClone(input)
  const solver = new LandmarkDistancePreparationSolver(input)
  solver.solve()
  expect([...solver.getOutput()]).toEqual([0, 10, 20, 30, Infinity])
  const runtime = createPipeline9TestRuntime(4)
  try {
    const results = await Promise.all([0, 1, 2, 3].map((landmark) =>
      runtime.executeAsync(LandmarkDistancePreparationSolver, { ...input, landmark })))
    for (const [landmark, distances] of results.entries()) {
      expect(distances[landmark]).toBe(0)
      expect(distances[4]).toBe(Infinity)
      expect(distances[0]).toBe(landmark * 10)
    }
    expect(input).toEqual(original)
  } finally {
    await runtime.dispose()
  }
})
