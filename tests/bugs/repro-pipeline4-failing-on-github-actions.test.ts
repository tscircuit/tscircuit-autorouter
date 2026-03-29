import { expect, test } from "bun:test"
import { Circle, mergeGraphics, type GraphicsObject } from "graphics-debug"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import circuit101 from "./assets/circuit101.json" with { type: "json" }
import { getLastStepGraphicsObject } from "tests/fixtures/getLastStepGraphicsObject"
import { AutoroutingPipelineSolver } from "lib/index"

test.skip("pipeline4 failing on github actions", async () => {
  const srj = circuit101 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(false)

  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Solver did not produce point pairs SRJ")
  }

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const circuitJson = convertToCircuitJson(
    srjWithPointPairs,
    simplifiedTraces,
    srj.minTraceWidth,
  )

  const { errors, locationAwareErrors } = getDrcErrors(circuitJson)
  console.log(`overlapCount: ${errors.length}`)

  const errorCircles: Circle[] =
    // TODO: This may break since we're using a string; need to verify if a better type is possible
    locationAwareErrors
      .filter((e) => {
        return e.message.includes("accidental contact")
      })
      .map((error) => ({
        center: error.center,
        radius: Math.max(srj.minTraceWidth * 3, 0.3),
        stroke: "red",
        fill: "rgba(255, 0, 0, 0.25)",
      }))

  const baseViz = solver.visualize()
  const finalViz = mergeGraphics(getLastStepGraphicsObject(baseViz), {
    circles: errorCircles,
  })
  expect(finalViz).toMatchGraphicsSvg(import.meta.path)
}, 120_000)
