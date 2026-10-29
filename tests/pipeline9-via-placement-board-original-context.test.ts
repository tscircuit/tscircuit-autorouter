import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("the opt-in context retains the original outline while the routing SRJ changes", (): void => {
  const input: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, minBoardEdgeClearance: 0.2,
    outline: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }],
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [
      { x: -2, y: 0, layer: "top" }, { x: 2, y: 0, layer: "bottom" }] }] }
  for (const constrainViaPadPlacement of [undefined, false, true]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
      constrainViaPadPlacement, cacheProvider: null, effort: 1,
    })
    // Stop before any HD search: exercise the actual coarse-to-HD handoff.
    for (let steps = 0; steps < 100_000 && !solver.failed &&
      solver.getCurrentPhase() !== "highDensityRouteSolver"; steps++) solver.step()
    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
    solver.srj = { ...solver.srj,
      bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      outline: undefined, minBoardEdgeClearance: 0 }
    solver.step()
    expect(solver.highDensityRouteSolver!.iterations).toBe(0)
    const context = solver.highDensityRouteSolver!.viaPlacementContext
    if (constrainViaPadPlacement !== true) {
      expect(context).toBeUndefined()
      continue
    }
    expect(context!.boardGeometry).toEqual({ bounds: input.bounds,
      outline: input.outline, minBoardEdgeClearance: 0.2 })
    const validate = getPipeline9ViaPlacementValidator(context!)
    const placement = { x: 2.9, y: 0, zStart: 0, zEnd: 3, viaDiameter: 0.3 }
    expect(validate(placement, "signal")).toBe(false)
    expect(validate({ ...placement, x: 2.65 }, "signal")).toBe(true)
    // The validator owns its geometry snapshot for its entire search lifetime.
    context!.boardGeometry.bounds.maxX = 100
    context!.boardGeometry.outline![1]!.x = 100
    context!.boardGeometry.outline![2]!.x = 100
    context!.boardGeometry.minBoardEdgeClearance = 0
    expect(validate(placement, "signal")).toBe(false)
  }
})
