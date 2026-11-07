import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getBounds, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

test("reproduces RAM byte-zero routing failure in the full SO-DIMM context", async (): Promise<void> => {
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
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
  expect(solver.highDensityRouteSolver?.failed).toBe(true)
  expect(solver.error).toContain("No path found for source_trace_17")
  expect(solver.highDensityRouteSolver?.failedSolvers).toHaveLength(1)
  const failedAttempt = solver.highDensityRouteSolver!.failedSolvers[0]!
  expect(failedAttempt.failed).toBe(true)

  // The failure view is solver state, not accepted RAM copper.
  const views = [
    {
      graphics: inputGraphics,
      title: "SO-DIMM input: 404 fixed routes, 11 pending RAM connections",
    },
    {
      graphics: solver.visualizeStage(failedAttempt),
      title: "Failed B01 RAM routing attempt: rejected copper",
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
