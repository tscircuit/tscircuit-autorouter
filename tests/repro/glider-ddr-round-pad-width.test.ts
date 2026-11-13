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
        readFileSync(
          new URL(
            "../fixtures/assets/glider-ddr-round-pad-width/width-input.json.gz",
            import.meta.url,
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

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
      includeTextLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
})
