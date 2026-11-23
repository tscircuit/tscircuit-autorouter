import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("snapshot the USB ground route near MCU pin 15", async (): Promise<void> => {
  const fixture = new URL(
    "../fixtures/usb-ground-mcu-pad.srj.json.gz",
    import.meta.url,
  )
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixture))).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBeTrue()

  // J1.A12 and the U1 exposed ground pad are ports 14 and 53 in this capture.
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const ground = routedTraces.filter(
    (trace) =>
      trace.connectsTo?.includes("pcb_port_14") &&
      trace.connectsTo.includes("pcb_port_53"),
  )
  expect(ground).toHaveLength(1)

  const pads = input.obstacles.filter(
    (o) => o.componentId === "pcb_component_3",
  )
  const pin15 = pads.findIndex(
    (o) => o.circuitJsonMetadata?.source_port_name === "pin15",
  )
  expect(pin15).toBeGreaterThanOrEqual(0)
  const graphics = convertSrjToGraphicsObject({
    ...input,
    connections: [],
    obstacles: pads,
    traces: ground,
  })
  graphics.rects[pin15]!.fill = "#fbbf24"
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  const label = `<text x="16" y="32" font-family="sans-serif" font-size="19">Full-board relaxed DRC errors: ${errors.length}</text>`
  await expect(svg.replace("</svg>", label + "</svg>")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
