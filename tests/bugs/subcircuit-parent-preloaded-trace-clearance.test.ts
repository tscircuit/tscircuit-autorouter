import { expect, test } from "bun:test"
import {
  type Circle,
  getSvgFromGraphicsObject,
  mergeGraphics,
  type Point,
} from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepGraphicsObject } from "tests/fixtures/getLastStepGraphicsObject"
import bugReport from "../../fixtures/bug-reports/subcircuit-parent-preloaded-trace-clearance/subcircuit-parent-preloaded-trace-clearance.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

type DataPixelPair = {
  data: Point
  pixel: Point
}

const cropSvgAroundErrors = (svg: string, errorCenters: Point[]) => {
  const dataPixelPairs: DataPixelPair[] = []
  const polylinePattern =
    /<polyline\b[^>]*\bdata-points="([^"]+)"[^>]*\bpoints="([^"]+)"/g

  for (const match of svg.matchAll(polylinePattern)) {
    const dataPoints = match[1]!.split(" ")
    const pixelPoints = match[2]!.split(" ")
    for (
      let pointIndex = 0;
      pointIndex < Math.min(dataPoints.length, pixelPoints.length);
      pointIndex += 1
    ) {
      const [dataX, dataY] = dataPoints[pointIndex]!.split(",").map(Number)
      const [pixelX, pixelY] = pixelPoints[pointIndex]!.split(",").map(Number)
      dataPixelPairs.push({
        data: { x: dataX!, y: dataY! },
        pixel: { x: pixelX!, y: pixelY! },
      })
    }
  }

  const origin = dataPixelPairs[0]
  const distinctX = dataPixelPairs.find(
    (pair) => Math.abs(pair.data.x - origin!.data.x) > 1e-9,
  )
  const distinctY = dataPixelPairs.find(
    (pair) => Math.abs(pair.data.y - origin!.data.y) > 1e-9,
  )
  if (!origin || !distinctX || !distinctY || errorCenters.length === 0) {
    throw new Error("Unable to crop autorouter repro snapshot")
  }

  const scaleX =
    (distinctX.pixel.x - origin.pixel.x) /
    (distinctX.data.x - origin.data.x)
  const scaleY =
    (distinctY.pixel.y - origin.pixel.y) /
    (distinctY.data.y - origin.data.y)
  const offsetX = origin.pixel.x - scaleX * origin.data.x
  const offsetY = origin.pixel.y - scaleY * origin.data.y
  const margin = 2
  const minX = Math.min(...errorCenters.map((center) => center.x)) - margin
  const maxX = Math.max(...errorCenters.map((center) => center.x)) + margin
  const minY = Math.min(...errorCenters.map((center) => center.y)) - margin
  const maxY = Math.max(...errorCenters.map((center) => center.y)) + margin
  const pixelXValues = [scaleX * minX + offsetX, scaleX * maxX + offsetX]
  const pixelYValues = [scaleY * minY + offsetY, scaleY * maxY + offsetY]

  return svg.replace(
    /viewBox="[^"]+"/,
    `viewBox="${Math.min(...pixelXValues)} ${Math.min(...pixelYValues)} ${Math.abs(pixelXValues[1]! - pixelXValues[0]!)} ${Math.abs(pixelYValues[1]! - pixelYValues[0]!)}"`,
  )
}

test.failing("parent routes clear preserved child-subcircuit traces", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  if (!solver.srjWithPointPairs) {
    throw new Error("Solver did not produce point-pair SRJ")
  }

  const { errors, locationAwareErrors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  const preservedTraceIds = new Set(
    (srj.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const parentToChildTraceErrors = errors.filter(
    (error) =>
      "pcb_trace_id" in error &&
      typeof error.pcb_trace_id === "string" &&
      preservedTraceIds.has(error.pcb_trace_id),
  )
  const locatedParentToChildTraceErrors = locationAwareErrors.filter(
    (error) =>
      "pcb_trace_id" in error &&
      typeof error.pcb_trace_id === "string" &&
      preservedTraceIds.has(error.pcb_trace_id),
  )
  const errorCircles: Circle[] = locatedParentToChildTraceErrors.map((error) => ({
    center: error.center,
    radius: 1.2,
    stroke: "red",
    fill: "rgba(255, 0, 0, 0.25)",
    label: error.message,
  }))
  const annotatedOutput = mergeGraphics(
    getLastStepGraphicsObject(solver.visualize()),
    { circles: errorCircles },
  )

  const annotatedSvg = getSvgFromGraphicsObject(annotatedOutput, {
    backgroundColor: "white",
  })

  expect(
    cropSvgAroundErrors(
      annotatedSvg,
      locatedParentToChildTraceErrors.map((error) => error.center),
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(parentToChildTraceErrors).toEqual([])
})
