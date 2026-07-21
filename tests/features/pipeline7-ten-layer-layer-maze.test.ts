import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getLastStepGraphicsObject } from "../fixtures/getLastStepGraphicsObject"
import { createTenLayerLayerMaze } from "../fixtures/ten-layer-layer-maze"

const REQUIRED_LAYERS = [
  "top",
  "inner1",
  "inner2",
  "inner3",
  "inner4",
  "inner5",
  "inner6",
  "inner7",
  "inner8",
  "bottom",
] as const

test("pipeline 7 routes a layer maze that requires exactly ten layers", () => {
  const input = createTenLayerLayerMaze()
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
    effort: 0.2,
  })

  solver.solve()

  expect(input.layerCount).toBe(10)
  const gates = input.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("gate-"),
  )
  expect(gates).toHaveLength(10)
  expect(gates.every((gate) => gate.layers.length === 9)).toBe(true)
  expect(input.obstacles[0]!.layers).toEqual(["top"])
  expect(input.obstacles.at(-1)!.layers).toEqual(["bottom"])
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const routedLayers = new Set<string>(
    simplifiedTraces
      .flatMap((trace) => trace.route)
      .filter((routePoint) => routePoint.route_type === "wire")
      .map((routePoint) => routePoint.layer),
  )
  expect(routedLayers).toEqual(new Set<string>(REQUIRED_LAYERS))

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    simplifiedTraces,
    { originalSrj: solver.originalSrj },
  )
  const exportedLayers = new Set<string>(
    circuitJson
      .filter((element) => element.type === "pcb_trace")
      .flatMap((trace) => trace.route)
      .filter((routePoint) => routePoint.route_type === "wire")
      .map((routePoint) => routePoint.layer),
  )
  expect(exportedLayers).toEqual(new Set<string>(REQUIRED_LAYERS))

  const finalOutputVisualization = solver.visualizeFinalOutput()
  const finalDebuggerVisualization = getLastStepGraphicsObject(
    solver.visualize(),
  )

  expect(finalDebuggerVisualization.rects).toHaveLength(
    finalOutputVisualization.rects.length,
  )
  expect(
    finalDebuggerVisualization.rects?.map((rect) => ({
      center: rect.center,
      layer: rect.layer,
      fill: rect.fill,
    })),
  ).toEqual(
    finalOutputVisualization.rects.map((rect) => ({
      center: rect.center,
      layer: rect.layer,
      fill: rect.fill,
    })),
  )
  expect(finalOutputVisualization).toMatchGraphicsSvg(import.meta.path)
})
