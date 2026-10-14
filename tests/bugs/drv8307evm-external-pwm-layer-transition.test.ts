import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

const srj = JSON.parse(
  gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL(
          "../../fixtures/bug-reports/drv8307evm-external-pwm/drv8307evm-external-pwm.srj.json.gz",
          import.meta.url,
        ),
      ),
    ),
  ).toString("utf8"),
) as SimpleRouteJson

test("routes the DRV8307EVM external PWM configuration", (): void => {
  expect(srj.connections).toHaveLength(51)
  expect(srj.obstacles).toHaveLength(262)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
})
