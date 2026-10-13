import { expect, test } from "bun:test"
import { normalizePipeline9HdRouteTerminalIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9HdRouteTerminalIds"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import fixture from "./fixtures/bug94-bottom-terminal-branch.json"

test("stitches the reachable bottom terminal past a duplicate via branch", (): void => {
  const original = structuredClone(fixture.hdRoutes)
  const routes = normalizePipeline9HdRouteTerminalIds(
    fixture.hdRoutes as HighDensityIntraNodeRoute[],
  )
  for (const orderedRoutes of [routes, [...routes].reverse()]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      ...fixture,
      hdRoutes: orderedRoutes,
      preserveTerminalPcbPortIds: true,
      validateTerminalContacts: true,
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const merged = solver.mergedHdRoute
    const terminals = new Map([
      [fixture.start.pcb_port_id, fixture.start],
      [fixture.end.pcb_port_id, fixture.end],
    ])
    for (const [id, point] of [
      [merged.startPcbPortId!, merged.route[0]!],
      [merged.endPcbPortId!, merged.route.at(-1)!],
    ] as const) {
      const terminal = terminals.get(id)!
      expect(terminal).toBeDefined()
      expect(point.z).toBe(terminal.z)
      expect(
        Math.hypot(point.x - terminal.x, point.y - terminal.y),
      ).toBeLessThan(0.001)
    }
    expect(merged.route).toContainEqual({
      x: 56.9,
      y: 32.387,
      z: 1,
    })
    const inputViaRoutes = routes.filter(
      (route): boolean =>
        route.regionId === "topology_merge_2688__sub_1_0" ||
        route.regionId === "topology_merge_2500",
    )
    expect(merged.vias).toHaveLength(2)
    const firstViaRoute = inputViaRoutes.find(
      (route): boolean => route.regionId === "topology_merge_2688__sub_1_0",
    )!
    expect(merged.vias).toContainEqual(firstViaRoute.vias[0]!)
    for (const via of merged.vias) {
      expect(
        inputViaRoutes.some((route): boolean =>
          route.vias.some(
            (inputVia): boolean => inputVia.x === via.x && inputVia.y === via.y,
          ),
        ),
      ).toBeTrue()
      expect(
        merged.route.some((point, index): boolean => {
          const next = merged.route[index + 1]
          return (
            next !== undefined &&
            point.z !== next.z &&
            point.x === via.x &&
            point.y === via.y &&
            next.x === via.x &&
            next.y === via.y
          )
        }),
      ).toBeTrue()
    }
    expect(fixture.hdRoutes).toEqual(original)
  }

  const disconnected = new SingleHighDensityRouteStitchSolver3({
    ...fixture,
    hdRoutes: routes.filter(
      (route): boolean =>
        route.regionId !== "cmn_848" &&
        route.regionId !== "topology_merge_2500" &&
        route.regionId !== "topology_merge_2497__sub_1_0",
    ),
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  disconnected.solve()
  expect(disconnected.solved).toBeFalse()
  expect(disconnected.failed).toBeTrue()
  expect(disconnected.error).toContain("has no path to its terminal")
  expect(disconnected.remainingHdRoutes.length).toBeGreaterThan(0)
})
