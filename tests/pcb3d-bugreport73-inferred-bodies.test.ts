import { expect, test } from "bun:test"
import { getPcb3dRenderSummary } from "lib/testing/Pcb3dViewer"
import type { SimpleRouteJson } from "lib/types"
import srj from "../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}

test("bugreport73 hides inferred bodies over authored plated holes by default", () => {
  const bugreport = srj as SimpleRouteJson
  const rightSidePlatedHoles = bugreport.obstacles.filter(
    (obstacle) =>
      obstacle.componentId === "pcb_component_2" &&
      obstacle.layers.length > 1 &&
      obstacle.connectedTo.some((id) => id.startsWith("pcb_plated_hole_")),
  )

  expect(rightSidePlatedHoles).toHaveLength(4)
  expect(rightSidePlatedHoles.every(({ center }) => center.x === 7)).toBe(true)
  expect(getPcb3dRenderSummary(bugreport, []).inferredBodies).toBe(0)
  expect(
    getPcb3dRenderSummary(bugreport, [], {
      includeInferredBodies: true,
    }).inferredBodies,
  ).toBeGreaterThan(0)
})
