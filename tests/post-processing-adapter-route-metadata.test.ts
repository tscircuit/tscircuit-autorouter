import { expect, test } from "bun:test"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { adaptAutorouterPostProcessingInput } from "lib/utils/adapt-autorouter-post-processing-input"

test("rebuilds vias and removes stale same-layer through markers", () => {
  const hdRoutes: PostProcessingSolverParams["hdRoutes"] = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.5,
      route: [
        { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
        { x: 1, y: 1, z: 0 },
        { x: 1, y: 1, z: 1, toNextSegmentType: "through_obstacle" },
        { x: 2, y: 2, z: 2 },
      ],
      vias: [{ x: 99, y: 99, zLayers: [0, 2] }],
    },
  ]

  const adapted = adaptAutorouterPostProcessingInput({
    hdRoutes,
    obstacles: [],
  })

  expect(adapted.hdRoutes[0]!.vias).toEqual([
    { x: 1, y: 1, zLayers: [0, 1] },
  ])
  expect(adapted.hdRoutes[0]!.route[0]!.toNextSegmentType).toBeUndefined()
  expect(adapted.hdRoutes[0]!.route[2]!.toNextSegmentType).toBe(
    "through_obstacle",
  )
  expect(hdRoutes[0]!.vias[0]!.x).toBe(99)
})
