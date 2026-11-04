import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("H3 DDR3 DQS0 leaves fragmented terminal pads beside sixteen fixed data routes", (): void => {
  const inputBytes = readFileSync(
    new URL(
      "../../fixtures/features/h3-ddr-strobes/input.srj.json.gz",
      import.meta.url,
    ),
  )
  const routedDataBytes = readFileSync(
    new URL(
      "../../fixtures/features/h3-ddr-strobes/routed-data.srj.json.gz",
      import.meta.url,
    ),
  )
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(inputBytes)).toString("utf8"),
  )
  const routedDataSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(routedDataBytes)).toString("utf8"),
  )
  const originalInput = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj)
  solver.solve()

  let routedTraces: SimplifiedPcbTraces = []
  let statusColor = "#b91c1c"
  if (solver.solved) {
    routedTraces = solver.getOutputSimplifiedPcbTraces()
    statusColor = "#166534"
  }
  const graphics: GraphicsObject = convertSrjToGraphicsObject({
    ...routedDataSrj,
    connections: inputSrj.connections,
    traces: [...(routedDataSrj.traces ?? []), ...routedTraces],
  })
  graphics.points = []
  graphics.texts = [
    {
      x: inputSrj.bounds.minX,
      y: inputSrj.bounds.maxY + 1,
      text: `H3 DDR3: 16 fixed DQ routes; DQS0 ${routedTraces.length}/2 routed`,
      anchorSide: "bottom_left",
      color: statusColor,
      fontSize: 0.65,
    },
  ]
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(routedTraces).toHaveLength(2)
  expect(
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])
  expect(inputSrj).toEqual(originalInput)
})
