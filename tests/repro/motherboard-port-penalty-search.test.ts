import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"

test("full motherboard native search progress at the same checkpoint", async (): Promise<void> => {
  const { inputSrj, preloadedTraces } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/motherboard-port-penalty-search.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; preloadedTraces: SimplifiedPcbTrace[] }
  // Complete motherboard capture from tscircuit 0.0.3209 / core 0.0.2400,
  // after native dogbone and the TPS25810 REF_RTN wiring correction.
  // Existing dogbone copper is already represented by input obstacles.
  // preloadedTraces supplies its geometry for display only.
  const inputHash = createHash("sha256")
    .update(JSON.stringify(inputSrj))
    .digest("hex")
  expect(inputSrj.connections).toHaveLength(448)
  expect(inputSrj.obstacles).toHaveLength(6449)
  expect(preloadedTraces).toHaveLength(351)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  while (!solver.portPointPathingSolver && !solver.solved && !solver.failed) {
    solver.step()
  }
  expect(solver.failed).toBeFalse()
  const pathing = solver.portPointPathingSolver!
  // Use the public resumable API to compare the same amount of search work.
  // This pauses the test; it does not change native limits or accept routes.
  const checkpoint = 1_000_000
  await pathing.solveAsync(undefined, checkpoint)
  expect(pathing.failed).toBeFalse()
  expect(pathing.solved).toBeFalse()
  expect(pathing.iterations).toBe(checkpoint)
  expect(
    createHash("sha256").update(JSON.stringify(inputSrj)).digest("hex"),
  ).toBe(inputHash)
  const search = pathing.activeSubSolver
  if (!(search instanceof PreparedPortPointRoutingSolver)) {
    throw new Error("Expected native prepared search at the checkpoint")
  }
  const assignedRoutes = new Set(
    search.state.regionSegments.flatMap((segments) =>
      segments.map(([routeId]) => routeId),
    ),
  )
  expect(search.problem.routeCount).toBe(1740)
  expect(assignedRoutes.size).toBe(93)
  const board = convertSrjToGraphicsObject({
    ...inputSrj,
    traces: preloadedTraces,
  })
  const preview = search.preview()
  const graphics: GraphicsObject = {
    ...board,
    lines: [...board.lines!, ...preview.lines!],
    circles: [...board.circles!, ...preview.circles!],
    texts: [
      {
        x: 0,
        y: 63,
        text: "4-MOTOR USB-C MOTHERBOARD / NATIVE SEARCH CHECKPOINT",
        fontSize: 2.6,
      },
      {
        x: 0,
        y: 58,
        text: `${assignedRoutes.size} / ${search.problem.routeCount} connections have graph paths after ${checkpoint.toLocaleString("en-US")} pathing steps`,
        fontSize: 2.2,
      },
      { x: -63, y: 51, text: "PD INPUT", fontSize: 1.5 },
      { x: -39, y: 51, text: "PC DATA", fontSize: 1.5 },
      { x: -17, y: 51, text: "CAMERA", fontSize: 1.5 },
      { x: 9, y: 47, text: "DDR3L", fontSize: 1.5 },
      { x: 9, y: 7, text: "STM32MP157D", fontSize: 1.6 },
      { x: -27, y: -52, text: "M1-M4 POWER", fontSize: 1.8 },
      { x: 45, y: -52, text: "M1-M4 USB DATA", fontSize: 1.8 },
      {
        x: 0,
        y: -59,
        text: "Same full circuit, placement, clearances and checkpoint / 154 x 97 mm / 6 layers",
        fontSize: 1.8,
      },
      {
        x: 0,
        y: -64,
        text: "Thin colored lines: assigned/candidate graph paths; pads and dogbone copper unchanged",
        fontSize: 1.8,
      },
      {
        x: 0,
        y: -69,
        text: "ROUTING INCOMPLETE: graph paths are not final copper; physical DRC has not run",
        fontSize: 1.8,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1600,
      svgHeight: 1400,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1, tolerance: 0 })
})
