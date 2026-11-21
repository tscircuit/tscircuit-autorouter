import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Obstacle } from "lib/types"
import { existingPlaneVias } from "tests/fixtures/existing-plane-vias"

test("Pipeline9 reuses vias across connected copper-pour tiles", (): void => {
  for (const variant of [
    "single rectangle",
    "touching tiles",
    "reversed tiles",
    "overlapping tiles",
    "transitive tiles",
    "missing bridge",
    "other-net bridge",
    "other-layer bridge",
    "existing and new vias",
  ]) {
    const input = structuredClone(existingPlaneVias)
    const plane = input.obstacles[0]!
    const vias = input.obstacles.slice(1)
    let pours: Obstacle[] = [plane]
    if (variant !== "single rectangle") {
      pours = [
        { ...plane, center: { x: -1.5, y: 0 }, width: 3 },
        { ...plane, center: { x: 1.5, y: 0 }, width: 3 },
      ]
    }
    if (variant === "reversed tiles") pours.reverse()
    if (variant === "overlapping tiles") {
      pours = [
        { ...plane, center: { x: -1.4, y: 0 }, width: 3.2 },
        { ...plane, center: { x: 1.4, y: 0 }, width: 3.2 },
      ]
    }
    if (variant === "transitive tiles" || variant.includes("bridge")) {
      pours = [
        { ...plane, center: { x: -1.75, y: 0 }, width: 2.5 },
        { ...plane, center: { x: 0, y: 0 }, width: 1 },
        { ...plane, center: { x: 1.75, y: 0 }, width: 2.5 },
      ]
      if (variant === "missing bridge") pours.splice(1, 1)
      if (variant === "other-net bridge") pours[1]!.connectedTo = ["VCC"]
      if (variant === "other-layer bridge") pours[1]!.layers = ["inner2"]
    }
    const needsNewVia = variant === "existing and new vias"
    // Keep the existing via in the second tile, away from the representative.
    if (needsNewVia) vias.shift()
    input.obstacles = [...pours, ...vias]
    const original = structuredClone(input)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    while (
      !solver.netToPointPairsSolver?.solved &&
      !solver.solved &&
      !solver.failed
    ) {
      solver.step()
    }
    expect(solver.failed).toBeFalse()
    expect(solver.escapeViaLocationSolver?.solved).toBeTrue()
    expect(solver.netToPointPairsSolver?.solved).toBeTrue()
    expect(input).toEqual(original)
    expect(solver.escapeViaLocationSolver!.createdEscapeVias).toHaveLength(
      needsNewVia ? 1 : 0,
    )
    const connections =
      solver.netToPointPairsSolver!.getNewSimpleRouteJson().connections
    expect({ variant, requests: connections.length }).toEqual({
      variant,
      requests: needsNewVia || variant.includes("bridge") ? 1 : 0,
    })
  }
})
