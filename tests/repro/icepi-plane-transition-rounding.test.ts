import { expect, test } from "bun:test"
import {
  SameNetViaMergerSolver,
  TraceSimplificationSolver,
} from "@tscircuit/trace-simplification-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import fixture from "./assets/icepi-plane-transition-rounding.json"

test("captures iCE/Pi plane transitions at the simplification boundary", async (): Promise<void> => {
  // Captured from run 43931646411, before the first simplification pass.
  // Board-world mm: +X right, +Y up. Three +1V5 routes, with 54 real pads.
  const input = structuredClone(fixture.input) as SimpleRouteJson
  const routes = structuredClone(
    fixture.stitchedRoutes,
  ) as HighDensityIntraNodeRoute[]
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  pipeline.highDensityStitchSolver = new MultipleHighDensityRouteStitchSolver3({
    connections: input.connections,
    hdRoutes: [],
    layerCount: input.layerCount,
  })
  pipeline.highDensityStitchSolver.mergedHdRoutes = routes
  const step = pipeline.pipelineDef.find(
    (candidate) => candidate.solverName === "traceSimplificationSolver",
  )!
  const [params] = step.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof TraceSimplificationSolver>
  const merger = new SameNetViaMergerSolver({
    inputHdRoutes: [...params.hdRoutes],
    obstacles: [...params.obstacles],
    otherHdRoutes: [],
    connMap: params.connMap,
    netByConnectionName: params.netByConnectionName,
    colorMap: params.colorMap,
    layerCount: params.layerCount,
  })
  let rejection: unknown
  try {
    merger.solve()
  } catch (error) {
    rejection = error
  }
  expect(rejection).toBeUndefined()
  expect(merger.failed).toBe(false)
  expect(merger.solved).toBe(true)
  expect(routes).toEqual(fixture.stitchedRoutes)
  const graphics = merger.visualize()
  graphics.rects ??= []
  graphics.rects.push({
    center: { x: 14.5, y: 0.5 },
    width: 5,
    height: 5,
    fill: "none",
    stroke: "#94a3b8",
  })
  graphics.texts ??= []
  graphics.texts.push({
    x: 14.5,
    y: 3.3,
    text: `iCE/Pi +1V5: via merger ${merger.solved ? "solved" : "failed"}`,
    fontSize: 0.13,
  })
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
