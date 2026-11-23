import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

type CapturedParams = Omit<Pipeline9HighDensitySolverParams, "connMap"> & {
  connMap: { netMap: Record<string, string[]> }
}

// Unmodified high-density parent constructor captured from an actual TSX run
// on tscircuit 0.0.3279 / core 0.0.2460 / autorouter 0.0.1154, without pours.
// Replay all nodes, pads and preloaded copper together. No saved output routes.
test("replays the captured parent through the terminal-via repair", async (): Promise<void> => {
  const fixture = readFileSync(
    new URL("../fixtures/through-via-terminal-parent.json.gz", import.meta.url),
  )
  const input: CapturedParams = JSON.parse(
    gunzipSync(new Uint8Array(fixture)).toString(),
  )
  const solver = new Pipeline9HighDensitySolver({
    ...input,
    connMap: new ConnectivityMap(input.connMap.netMap),
  })
  solver.solve()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("cmn_248")
  expect(solver.stats.solvedNodeCount).toBe(1477)
  expect(
    solver.routes.some((route) => route.regionId === "cmn_248"),
  ).toBeFalse()
  const graphics = solver.visualize({ showAcceptedRoutes: true })
  // Every drilled via in this captured four-layer input is a through via.
  expect(new Set(graphics.circles!.map((via) => via.layer))).toEqual(
    new Set(["z0,1,2,3"]),
  )
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
