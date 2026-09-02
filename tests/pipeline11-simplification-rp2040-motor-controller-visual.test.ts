import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import realBoard from "fixtures/real-boards/rp2040-motor-controller-board.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver11_Simplification } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/AutoroutingPipelineSolver11_Simplification"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const addPanelTitle = (svg: string, title: string): string => {
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1])
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1])
  if (bodyStart === 0 || bodyEnd === -1 || !width || !height) {
    throw new Error("Expected complete SVG dimensions and markup")
  }

  const headerHeight = 42
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="25" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

test("simplifies traces from the RP2040 motor controller board", async () => {
  // Captured from the board and MCU autorouting events produced by
  // https://tscircuit.com/imrishabh18/rp2040-motor-controller at
  // tscircuit/rp2040-motor-controller commit b4560e5.
  const input = structuredClone(realBoard) as unknown as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver11_Simplification(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutputSimpleRouteJson()
  const inputPointCount = input.traces!.reduce(
    (count, trace) => count + trace.route.length,
    0,
  )
  const outputPointCount = output.traces!.reduce(
    (count, trace) => count + trace.route.length,
    0,
  )
  const inputViaCount = input
    .traces!.flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via").length
  const outputViaCount = output
    .traces!.flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via").length

  expect(outputPointCount).toBeLessThan(inputPointCount)
  expect(outputViaCount).toBeLessThan(inputViaCount)
  const inputByTraceId = new Map(
    input.traces!.map((trace) => [trace.pcb_trace_id, trace]),
  )
  for (const outputTrace of output.traces!) {
    const inputTrace = inputByTraceId.get(outputTrace.pcb_trace_id)!
    const inputWidths = new Set(
      inputTrace.route.flatMap((point) =>
        point.route_type === "wire" || point.route_type === "through_obstacle"
          ? [point.width]
          : [],
      ),
    )
    const outputWidths = new Set(
      outputTrace.route.flatMap((point) =>
        point.route_type === "wire" || point.route_type === "through_obstacle"
          ? [point.width]
          : [],
      ),
    )
    expect(outputWidths).toEqual(inputWidths)
    if (inputWidths.size > 1) expect(outputTrace.route).toEqual(inputTrace.route)
  }
  const drcInputSrj = { ...input, traces: [] }
  const inputDrcErrors = evaluateRelaxedDrc({
    inputSrj: drcInputSrj,
    srjWithPointPairs: input,
    routedTraces: input.traces!,
  }).errors
  const outputDrcErrors = evaluateRelaxedDrc({
    inputSrj: drcInputSrj,
    srjWithPointPairs: input,
    routedTraces: output.traces!,
  }).errors
  expect(inputDrcErrors).toEqual([])
  expect(outputDrcErrors).toEqual([])

  const renderOptions = {
    backgroundColor: "white",
    hideInlineLabels: true,
  } as const
  const inputSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(input, { traceColorMode: "layer" }),
    renderOptions,
  )
  const outputSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(output, { traceColorMode: "layer" }),
    renderOptions,
  )

  await expect(
    stackSvgsHorizontally(
      [
        addPanelTitle(
          inputSvg,
          `REAL BOARD INPUT · ${inputPointCount} POINTS · ${inputViaCount} VIAS · ${inputDrcErrors.length} DRC`,
        ),
        addPanelTitle(
          outputSvg,
          `SIMPLIFIED · ${outputPointCount} POINTS · ${outputViaCount} VIAS · ${outputDrcErrors.length} DRC`,
        ),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "rp2040-motor-controller-before-after",
  })
})
