import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("full motherboard exhausts the initial tiny-hypergraph path search", async (): Promise<void> => {
  // Same complete 4-Motor USB-C motherboard capture as
  // motherboard-existing-vias-to-planned-plane.test.ts.
  const { inputSrj, preloadedTraces } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/motherboard-existing-plane-vias.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; preloadedTraces: SimplifiedPcbTrace[] }
  expect(inputSrj.connections).toHaveLength(443)
  expect(inputSrj.obstacles).toHaveLength(6449)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  // Run the normal pipeline through tiny-hypergraph path planning only.
  while (
    !solver.solved &&
    !solver.failed &&
    !solver.portPointPathingSolver?.solved &&
    !solver.portPointPathingSolver?.failed
  ) {
    solver.step()
  }
  const pathing = solver.portPointPathingSolver
  if (!pathing) throw new Error("Motherboard never reached path planning")
  const stats = pathing.stats as Record<string, unknown>

  expect(
    solver.netToPointPairsSolver?.getNewSimpleRouteJson().connections,
  ).toHaveLength(1745)
  // Path planning gives up at its iteration cap with most routes unplanned.
  expect(pathing.failed).toBeTrue()
  expect(pathing.error).toBe(
    "PreparedPortPointRoutingSolver ran out of iterations",
  )
  expect(pathing.iterations).toBe(6_000_001)
  expect(stats.greedyFinalRouteRemainingRouteCount).toBe(978)
  expect(stats.neverSuccessfullyRoutedRouteCount).toBe(1)

  const board = convertSrjToGraphicsObject({
    ...inputSrj,
    traces: preloadedTraces,
  })
  const graphics: GraphicsObject = {
    ...board,
    rects: [
      {
        center: { x: 0, y: 0 },
        width: inputSrj.bounds.maxX - inputSrj.bounds.minX,
        height: inputSrj.bounds.maxY - inputSrj.bounds.minY,
        fill: "none",
        stroke: "#475569",
      },
      ...(board.rects ?? []),
    ],
    texts: [
      { x: 0, y: 63, text: "4-MOTOR USB-C CONTROL MOTHERBOARD", fontSize: 3 },
      {
        x: 0,
        y: 58,
        text: "Pipeline 9 initial tiny-hypergraph path search (no copper routed yet)",
        fontSize: 1.8,
      },
      {
        x: 0,
        y: -60,
        text: `Path search: ${pathing.failed ? "FAILED" : "solved"} after ${pathing.iterations} iterations`,
        fontSize: 2.1,
      },
      {
        x: 0,
        y: -65,
        text: `Unplanned connections after final greedy attempt: ${stats.greedyFinalRouteRemainingRouteCount} / 1745`,
        fontSize: 2.1,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1600,
      svgHeight: 1400,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
