import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const fixturePath = new URL(
  "../../fixtures/bug-reports/t113-linux-zero-length-layer-bridge/t113-linux-hdmi-clock.srj.json.gz",
  import.meta.url,
)

test("reproduces the T113 zero-length layer bridge reconstruction failure", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixturePath))).toString("utf8"),
    (_key, value) =>
      value?.value_type === "undefined" ? undefined : value,
  ) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )

  expect(() => solver.solve()).toThrow(
    'Pipeline9 could not reconnect mutated preloaded segment "breakout:pcb_breakout_point_50_fixed_30_2"',
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 1_080_000)
