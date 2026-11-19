import { expect, test } from "bun:test"
import type { Obstacle } from "@tscircuit/capacity-autorouter"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { buildOutputSimpleRouteJson } from "lib/build-output"
import { routeBus } from "lib/route-bus"
import { segmentIsClearOfObstacles } from "lib/route-bus/plan-static-clearance"
import { validateRoutedCopperDrc } from "lib/validate-routed-copper-drc"
import { visualizeSimpleRouteJson } from "lib/visualize-simple-route-json"
import { createIcepiPlaneDrop } from "./fixtures/icepi-plane-drop"

test("native segment clearance preserves copper while avoiding distant exact checks", async (): Promise<void> => {
  const params = createIcepiPlaneDrop()
  const inputBefore = JSON.stringify(params.srj)
  const plans = routeBus(params)
  expect(plans).toHaveLength(1)
  const plan = plans?.[0]
  if (!plans || !plan) throw new Error("Native plane escape was rejected")

  let activeObstacle: Obstacle | undefined
  let exactChecks = 0
  for (const obstacle of params.srj.obstacles) {
    const shape: unknown = Reflect.get(obstacle, "shape")
    Object.defineProperty(obstacle, "shape", {
      get(): unknown {
        if (obstacle === activeObstacle) exactChecks++
        return shape
      },
      configurable: true,
      enumerable: true,
    })
  }
  // One obstacle per call keeps the count specific to its distance kernel;
  // terminal-body exemptions can also read other pads' shape metadata.
  const nativeSegmentsAreClear = plan.segments.every((segment, segmentIndex) =>
    params.srj.obstacles.every((obstacle) => {
      activeObstacle = obstacle
      return segmentIsClearOfObstacles({
        segment,
        plan,
        segmentIndex,
        srj: params.srj,
        allowSameNetMerges: false,
        obstacles: [obstacle],
        clearance: params.clearance,
      })
    }),
  )
  activeObstacle = undefined
  expect(nativeSegmentsAreClear).toBe(true)
  const routedSrj = buildOutputSimpleRouteJson({
    inputSrj: params.srj,
    plans,
    layerNames: params.layerNames,
  })
  expect(
    validateRoutedCopperDrc({
      inputSrj: params.srj,
      routedSrj,
      clearance: params.clearance,
      allowBlindAndBuriedVias: false,
    }),
  ).toMatchObject({ valid: true, issues: [] })
  expect(JSON.stringify(params.srj)).toBe(inputBefore)

  const boundary = params.bus.sharedBoundary
  const viewport = {
    minX: boundary.minX - 1.5,
    maxX: boundary.maxX + 1.5,
    minY: boundary.minY - 1.5,
    maxY: boundary.maxY + 1.5,
  }
  const graphics = visualizeSimpleRouteJson({
    ...params.srj,
    bounds: viewport,
    connections: [params.bus.connections[0]!.connection],
    traces: plans.map((candidate) => candidate.trace),
  })
  graphics.texts = [
    {
      x: viewport.minX,
      y: viewport.maxY + 0.8,
      text: `U22 escape: ${plans.length} route; ${plans.filter((candidate) => candidate.via).length} through-via`,
      fontSize: 0.3,
      color: "#0f172a",
      anchorSide: "center_left",
    },
    {
      x: viewport.minX,
      y: viewport.maxY + 0.3,
      text: `Exact segment-obstacle distance checks: ${exactChecks}`,
      fontSize: 0.25,
      color: "#475569",
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
