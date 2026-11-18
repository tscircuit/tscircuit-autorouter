import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  type GraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("A64 native DDR initial path search", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/a64-native-initial-path-search.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  let initialSearch: TinyHyperGraphSolver | undefined
  while (
    !solver.failed &&
    !solver.solved &&
    !initialSearch?.solved &&
    !initialSearch?.failed
  ) {
    solver.step()
    const active = solver.portPointPathingSolver?.activeSubSolver
    if (!initialSearch && active instanceof TinyHyperGraphSolver) {
      initialSearch = active
    }
  }
  if (!initialSearch) throw new Error("A64 never reached path planning")

  expect(input.connections).toHaveLength(43)
  const plannedRoutes = new Set(
    initialSearch.state.regionSegments.flatMap((segments) =>
      segments.map(([routeId]) => routeId),
    ),
  )
  expect(initialSearch.problem.routeCount).toBe(77)
  expect(initialSearch.failed).toBe(true)
  expect(initialSearch.error).toContain("ran out of iterations")
  expect(initialSearch.state.candidateQueue.length).toBeGreaterThan(0)
  expect(plannedRoutes.size).toBeLessThan(initialSearch.problem.routeCount)
  const graphics: GraphicsObject = convertSrjToGraphicsObject(input)
  const plan = initialSearch.preview()
  graphics.lines = [...(graphics.lines ?? []), ...(plan.lines ?? [])]
  graphics.circles = [...(graphics.circles ?? []), ...(plan.circles ?? [])]
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([graphics], {
        titles: [
          `A64 native DDR | ${plannedRoutes.size}/${initialSearch.problem.routeCount} point-to-point paths planned`,
        ],
      }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
