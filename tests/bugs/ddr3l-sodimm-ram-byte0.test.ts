import { expect, test } from "bun:test"
import { LengthMatchingNoSolutionError } from "@tscircuit/length-matching-solver"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getBounds, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

test("routes the full SO-DIMM RAM byte to its remaining length-matching failure", async (): Promise<void> => {
  const rawInput = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL(
          "../../fixtures/bug-reports/ddr3l-sodimm/ram-byte0.srj.json.gz",
          import.meta.url,
        ),
      ),
    ),
  )
  expect(
    createHash("sha256").update(Uint8Array.from(rawInput)).digest("hex"),
  ).toBe("f534f093d2bf7be6819cc40c77e6881e2b7ca193c97d0d3abf821eb8ef1863d3")
  const input = JSON.parse(rawInput.toString("utf8")) as SimpleRouteJson
  expect(input.layerCount).toBe(6)
  expect(input.obstacles).toHaveLength(1068)
  expect(input.outline).toHaveLength(77)
  expect(input.traces).toHaveLength(404)
  expect(input.connections).toHaveLength(11)
  expect(input.buses?.[0]?.maxLengthSkew).toBe(0.3)
  expect(input.differentialPairs?.[0]?.lengthTolerance).toBe(0.06)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  const inputGraphics = solver.visualize()
  inputGraphics.points = []
  while (
    !solver.solved &&
    !solver.failed &&
    solver.getCurrentPhase() !== "lengthMatchingPostProcessingSolver"
  ) {
    solver.step()
  }
  expect(solver.highDensityRouteSolver?.solved).toBe(true)
  expect(solver.getCurrentPhase()).toBe("lengthMatchingPostProcessingSolver")
  expect(solver.lengthMatchingPostProcessingSolver).toBeUndefined()
  const newTraces = solver.getNewTracesBeforePowerExpansion()
  const preloadedTraces = solver.getUpdatedPreloadedTraces()
  expect(newTraces).toHaveLength(11)
  expect(preloadedTraces).toHaveLength(404)
  expect(new Set(newTraces.map((trace) => trace.connection_name))).toEqual(
    new Set(input.connections.map((connection) => connection.name)),
  )
  const candidateGraphics = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    { ...input, traces: [...preloadedTraces, ...newTraces] },
    { cacheProvider: null },
  ).visualize()
  candidateGraphics.points = []
  expect(() => solver.solve()).toThrow(LengthMatchingNoSolutionError)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)

  // These are native checkpoint routes; timing acceptance is still blocked.
  const views = [
    {
      graphics: inputGraphics,
      title: "SO-DIMM input: 404 fixed routes, 11 pending RAM connections",
    },
    {
      graphics: candidateGraphics,
      title: "SO-DIMM: 11 candidate RAM routes; clearance and timing unfinished",
    },
  ]
  const svgs = views.map(({ graphics, title }) => {
    const bounds = getBounds(graphics)
    const fontSize =
      Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) /
      title.length
    return getSvgFromGraphicsObject(
      {
        ...graphics,
        coordinateSystem: "cartesian",
        texts: [
          ...(graphics.texts ?? []),
          {
            x: bounds.minX,
            y: bounds.maxY + fontSize * 2,
            text: title,
            fontSize,
            anchorSide: "center_left",
          },
        ],
      },
      { backgroundColor: "white", svgWidth: 1000, svgHeight: 650 },
    )
  })
  await expect(
    stackSvgsHorizontally(svgs, { normalizeSize: false }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
