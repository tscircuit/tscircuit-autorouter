import { expect, test } from "bun:test"
import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { adaptAutorouterPostProcessingInput } from "lib/utils/adapt-autorouter-post-processing-input"

test("converts a legacy oval to its rectangular bounding obstacle", () => {
  const legacyOval = {
    type: "oval",
    layers: ["top"],
    center: { x: 4, y: 5 },
    width: 2,
    height: 6,
    connectedTo: ["P"],
  } as unknown as PostProcessingSolverParams["obstacles"][number]

  const adapted = adaptAutorouterPostProcessingInput({
    hdRoutes: [],
    obstacles: [legacyOval],
  })

  expect(adapted.obstacles).toEqual([
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4, y: 5 },
      width: 2,
      height: 6,
      connectedTo: ["P"],
    },
  ])
  expect((legacyOval as unknown as { type: string }).type).toBe("oval")
})
