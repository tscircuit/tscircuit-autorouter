import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  viaX,
  transitionX = viaX,
}: {
  connectionName: string
  viaX: number
  transitionX?: number
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: transitionX - 0.5, y: 0, z: 0 },
    { x: transitionX, y: 0, z: 0 },
    { x: transitionX, y: 0, z: 1 },
    { x: transitionX + 0.5, y: 0, z: 1 },
  ],
  vias: [{ x: viaX, y: 0 }],
})

test("repro: preloaded via rounding hides valid transition layers", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute({ connectionName: "route-a", viaX: 0 }),
      makeViaRoute({
        connectionName: "preloaded-route-b",
        viaX: 0.4,
        transitionX: 0.4004,
      }),
    ],
    obstacles: [],
    colorMap: {
      "route-a": "#ef4444",
      "preloaded-route-b": "#3b82f6",
    },
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["route-a", "preloaded-route-b"],
    }),
  })

  const consoleError = spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(() => solver.solve()).toThrow(
      "could not find transition layers for via at (0.4, 0)",
    )
  } finally {
    consoleError.mockRestore()
  }
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain(
    "could not find transition layers for via at (0.4, 0)",
  )
  const graphics = solver.visualize()
  graphics.texts = [
    ...(graphics.texts ?? []),
    {
      x: -0.45,
      y: 0.42,
      text: "BUG • rounded lookup loses preloaded via layers",
      fontSize: 0.06,
      color: "#111827",
      anchorSide: "center_left",
    },
    {
      x: -0.45,
      y: 0.31,
      text: "via x=0.4000 • transition x=0.4004",
      fontSize: 0.05,
      color: "#b91c1c",
      anchorSide: "center_left",
    },
  ]
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
