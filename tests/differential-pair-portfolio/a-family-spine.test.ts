import { expect, test } from "bun:test"
import {
  createAFamilySpine,
  type AFamilySpineInput,
} from "../../scripts/differential-pair-portfolio/aFamilySpine"

test("A13 spine adapter returns clear envelope and rejects fixed crossing copper", (): void => {
  const input: AFamilySpineInput = {
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    layerCount: 2,
    start: { x: -4, y: 0, z: 0 },
    end: { x: 4, y: 0, z: 0 },
    traceWidth: 0.5,
    viaDiameter: 0.9,
    obstacles: [],
    existingTraces: [],
  }
  const clear = createAFamilySpine(input)
  if (clear.status !== "ready") throw new Error(clear.reason)
  clear.solver.solve()
  expect(clear.solver.solved).toBe(true)
  const candidate = clear.getCandidate()
  expect(candidate?.[0]).toEqual(input.start)
  expect(candidate?.at(-1)).toEqual(input.end)
  const blocked = createAFamilySpine({
    ...input,
    existingTraces: [
      {
        connectionName: "unrelated",
        traceThickness: 0.3,
        viaDiameter: 0.5,
        route: [
          { x: 0, y: -2, z: 0 },
          { x: 0, y: 2, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  if (blocked.status !== "ready") throw new Error(blocked.reason)
  blocked.solver.solve()
  expect(blocked.solver.failed).toBe(true)
  expect(blocked.getCandidate()).toBeNull()
  expect(blocked.solver.error).toContain("board copper validation")
})
