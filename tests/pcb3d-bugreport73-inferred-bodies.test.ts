import { expect, test } from "bun:test"
import {
  getPcb3dRenderSummary,
  getPcb3dSceneObjectStates,
} from "lib/testing/Pcb3dViewer"
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
  expect(
    rightSidePlatedHoles.every((obstacle) => obstacle.center.x === 7),
  ).toBe(true)

  const rightSideHoleSrj: SimpleRouteJson = {
    ...bugreport,
    obstacles: rightSidePlatedHoles,
  }
  expect(getPcb3dRenderSummary(rightSideHoleSrj, []).inferredBodies).toBe(0)
  expect(
    getPcb3dRenderSummary(rightSideHoleSrj, [], {
      includeInferredBodies: true,
    }).inferredBodies,
  ).toBe(1)

  const defaultScene = getPcb3dSceneObjectStates(rightSideHoleSrj, [])
  const inferredBody = defaultScene.find(
    (object) => object.label === "pcb_component_2 · inferred body",
  )
  const visibleHoles = defaultScene.filter(
    (object) => object.category === "holes" && object.visible,
  )
  expect(inferredBody?.visible).toBe(false)
  expect(visibleHoles).toHaveLength(4)

  const sceneWithInferredBodies = getPcb3dSceneObjectStates(
    rightSideHoleSrj,
    [],
    { includeInferredBodies: true },
  )
  expect(
    sceneWithInferredBodies.find(
      (object) => object.label === "pcb_component_2 · inferred body",
    )?.visible,
  ).toBe(true)
})
