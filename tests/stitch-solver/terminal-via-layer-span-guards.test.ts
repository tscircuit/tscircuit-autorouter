import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("four-layer terminal stitching cannot extend blind vias or orphan via entries to bottom copper", (): void => {
  for (const viaEvidence of [
    "blind",
    "orphan",
    "protected",
    "opposite",
    "subset",
  ] as const) {
    const spanEndZ =
      viaEvidence === "protected" || viaEvidence === "subset" ? 3 : 1
    const route: HighDensityIntraNodeRoute = {
      connectionName: "blind-via-net",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route:
        viaEvidence === "orphan"
          ? [
              { x: 0, y: 0, z: 0 },
              { x: 2, y: 0, z: 0 },
            ]
          : [
              { x: 0, y: 0, z: 0 },
              {
                x: 2,
                y: 0,
                z: 0,
                ...(viaEvidence === "protected"
                  ? { toNextSegmentType: "through_obstacle" as const }
                  : {}),
              },
              { x: 2, y: 0, z: spanEndZ },
              { x: 1.5, y: 0, z: spanEndZ },
            ],
      vias: [{ x: 2, y: 0 }],
    }
    const inputSnapshot = structuredClone(route)
    const endLayer =
      viaEvidence === "protected" || viaEvidence === "opposite"
        ? 0
        : viaEvidence === "subset"
          ? 1
          : 3
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: route.connectionName,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 0, z: endLayer },
      hdRoutes: [route],
      allowedLayerTransitionPointKeys: new Set([getXyPointKey({ x: 2, y: 0 })]),
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "prefer_clear",
    })
    solver.solve()

    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("existing allowed via")
    expect(solver.mergedHdRoute.route).toEqual(route.route)
    expect(solver.mergedHdRoute.vias).toEqual(route.vias)
    expect(route).toEqual(inputSnapshot)
  }
})
