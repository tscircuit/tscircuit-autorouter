import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getStepGraphicsObject } from "tests/fixtures/getStepGraphicsObject"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const inputHdRoutes: HighDensityRoute[] = [
  {
    connectionName: "upper-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.8, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0.8, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  },
  {
    connectionName: "lower-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.6, y: -0.8, z: 0 },
      { x: 0.6, y: 0, z: 0 },
      { x: 0.6, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0.25, y: 0 }],
  },
]

const obstacle: Obstacle = {
  obstacleId: "foreign-pad",
  type: "rect",
  center: { x: 0.55, y: 0.55 },
  width: 0.25,
  height: 0.25,
  layers: ["top", "bottom"],
  connectedTo: ["foreign-net"],
}

test("same-net via merger visualization shows accepted geometry changes", async () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [obstacle],
    colorMap: {
      "upper-route": "#7c3aed",
      "lower-route": "#0891b2",
    },
    layerCount: 2,
    connMap: new ConnectivityMap({
      sharedNet: ["upper-route", "lower-route"],
      "foreign-net": ["foreign-pad"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.viaMerges).toEqual([
    {
      connectionName: "lower-route",
      from: { x: 0.6, y: 0 },
      to: { x: 0, y: 0 },
    },
  ])
  const visualization = solver.visualize()
  expect(
    visualization.lines?.some(
      (line) => line.step === 3 && line.label === "Via merge movement",
    ),
  ).toBe(true)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: two nearby same-net vias",
          step: 1,
          graphics: getStepGraphicsObject({
            graphics: visualization,
            step: 1,
          }),
        },
        {
          name: "After: one retained physical via site",
          step: 2,
          graphics: getStepGraphicsObject({
            graphics: visualization,
            step: 2,
          }),
        },
        {
          name: "Movement: removed site to retained site",
          step: 3,
          graphics: getStepGraphicsObject({
            graphics: visualization,
            step: 3,
          }),
        },
      ],
      columns: 3,
      cellHeight: 1.8,
      backgroundColor: "white",
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "before-after",
  })
})
