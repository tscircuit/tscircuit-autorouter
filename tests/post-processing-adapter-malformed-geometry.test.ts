import { expect, test } from "bun:test"
import {
  PostProcessingSolver,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import { adaptAutorouterPostProcessingInput } from "lib/utils/adapt-autorouter-post-processing-input"

test("does not hide an in-plane move during a layer transition", () => {
  const hdRoutes: PostProcessingSolverParams["hdRoutes"] = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.5,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 99, y: 99 }],
    },
  ]
  const adapted = adaptAutorouterPostProcessingInput({
    hdRoutes,
    obstacles: [],
    differentialPairs: [],
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
    layerCount: 2,
  })

  expect(() => new PostProcessingSolver(adapted)).toThrow(
    "moves in-plane while changing layers",
  )
})
