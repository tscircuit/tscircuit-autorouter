import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  TraceWidthSolver,
  type TraceWidthSolverInput,
} from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Glider DDR width selection beside round BGA pads", async (): Promise<void> => {
  const capture: { input: SimpleRouteJson; params: TraceWidthSolverInput } =
    JSON.parse(
      gunzipSync(
        Uint8Array.from(
          readFileSync(
            new URL(
              "../fixtures/assets/glider-ddr-round-pad-width/width-input.json.gz",
              import.meta.url,
            ),
          ),
        ),
      ).toString("utf8"),
    )
  const solver = new TraceWidthSolver({
    ...capture.params,
    connMap: getConnectivityMapFromSimpleRouteJson(capture.input),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  solver.refineWidths({ hdRoutes: solver.getHdRoutesWithWidths() })
  for (const name of [
    "source_trace_0",
    "source_trace_7",
    "source_trace_45",
    "source_trace_48",
  ]) {
    const route = solver
      .getHdRoutesWithWidths()
      .find((route) => route.connectionName === name)
    expect(route?.traceThickness).toBe(0.127)
  }

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
      includeTextLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
})
