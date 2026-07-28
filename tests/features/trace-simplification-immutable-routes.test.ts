import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

const editableRoute: HighDensityRoute = {
  connectionName: "editable",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -2, y: 0, z: 0 },
    { x: -1.5, y: 0.2, z: 0 },
    { x: -1.2, y: 1.2, z: 0 },
    { x: -0.6, y: 1.6, z: 0 },
    { x: 0, y: 1.8, z: 0 },
    { x: 0.6, y: 1.6, z: 0 },
    { x: 1.2, y: 1.2, z: 0 },
    { x: 1.5, y: 0.2, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  vias: [],
}

const immutableRoute: HighDensityRoute = {
  connectionName: "fixed_piece",
  rootConnectionName: "fixed",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: -0.65, z: 0 },
    { x: 0, y: 0.65, z: 0 },
  ],
  vias: [],
}

const createTraceSimplifier = (otherHdRoutes: HighDensityRoute[] = []) => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["fixed", "fixed_piece"]])
  return new TraceSimplificationSolver({
    hdRoutes: [structuredClone(editableRoute)],
    otherHdRoutes,
    obstacles: [],
    connMap,
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })
}

const solve = (otherHdRoutes: HighDensityRoute[] = []) => {
  const solver = createTraceSimplifier(otherHdRoutes)
  solver.solve()
  expect(solver.failed).toBe(false)
  return solver.simplifiedHdRoutes
}

const getMinimumRouteDistance = (
  first: HighDensityRoute,
  second: HighDensityRoute,
) => {
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let firstIndex = 1; firstIndex < first.route.length; firstIndex++) {
    const firstStart = first.route[firstIndex - 1]!
    const firstEnd = first.route[firstIndex]!
    if (firstStart.z !== firstEnd.z) continue

    for (
      let secondIndex = 1;
      secondIndex < second.route.length;
      secondIndex++
    ) {
      const secondStart = second.route[secondIndex - 1]!
      const secondEnd = second.route[secondIndex]!
      if (secondStart.z !== secondEnd.z || firstStart.z !== secondStart.z) {
        continue
      }
      minimumDistance = Math.min(
        minimumDistance,
        minimumDistanceBetweenSegments(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd,
        ),
      )
    }
  }
  return minimumDistance
}

const getRouteGraphics = ({
  route,
  strokeColor,
  strokeWidth,
  strokeDash,
  pointFill,
}: {
  route: HighDensityRoute
  strokeColor: string
  strokeWidth: number
  strokeDash?: number[]
  pointFill?: string
}): GraphicsObject => ({
  lines: route.route.slice(1).flatMap((point, index) => {
    const previousPoint = route.route[index]!
    if (previousPoint.z !== point.z) return []
    return [
      {
        points: [previousPoint, point],
        strokeColor,
        strokeWidth,
        strokeDash,
      },
    ]
  }),
  circles: pointFill
    ? route.route.map((point) => ({
        center: point,
        radius: 0.055,
        fill: pointFill,
        stroke: strokeColor,
      }))
    : [],
})

const mergeGraphics = (
  ...graphicsObjects: GraphicsObject[]
): GraphicsObject => ({
  coordinateSystem: "cartesian",
  lines: graphicsObjects.flatMap((graphics) => graphics.lines ?? []),
  circles: graphicsObjects.flatMap((graphics) => graphics.circles ?? []),
})

const addPanelHeader = ({
  svg,
  title,
  details,
}: {
  svg: string
  title: string
  details: [string, string]
}) => {
  const headerHeight = 76
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 640)
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 420)

  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="16" y="43" font-family="monospace" font-size="12" fill="#444">${details[0]}</text><text x="16" y="61" font-family="monospace" font-size="12" fill="#444">${details[1]}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

test("trace simplification avoids immutable routed traces without emitting or mutating them", () => {
  const immutableSnapshot = structuredClone(immutableRoute)

  const routesWithoutFixedCopper = solve()
  expect(routesWithoutFixedCopper).toHaveLength(1)
  expect(
    getMinimumRouteDistance(routesWithoutFixedCopper[0]!, immutableRoute),
  ).toBe(0)

  const routesWithFixedCopper = solve([immutableRoute])
  expect(routesWithFixedCopper).toHaveLength(1)
  expect(routesWithFixedCopper[0]!.connectionName).toBe("editable")
  expect(
    getMinimumRouteDistance(routesWithFixedCopper[0]!, immutableRoute),
  ).toBeGreaterThanOrEqual(0.25)
  expect(immutableRoute).toEqual(immutableSnapshot)
})

test("trace simplification visualizes immutable routed peers", () => {
  const solver = createTraceSimplifier([immutableRoute])
  solver.solve()

  expect(solver.failed).toBe(false)
  const simplifiedRoute = solver.simplifiedHdRoutes[0]!
  expect(editableRoute.route).toHaveLength(9)
  expect(simplifiedRoute.route).toHaveLength(5)

  const immutableGraphics = getRouteGraphics({
    route: immutableRoute,
    strokeColor: "#3f3f46",
    strokeWidth: 0.16,
    strokeDash: [0.06, 0.06],
    pointFill: "#d4d4d8",
  })
  const inputGraphics = mergeGraphics(
    getRouteGraphics({
      route: editableRoute,
      strokeColor: "#d97706",
      strokeWidth: 0.12,
      pointFill: "#ffedd5",
    }),
    immutableGraphics,
  )
  const outputGraphics = mergeGraphics(
    getRouteGraphics({
      route: editableRoute,
      strokeColor: "rgba(217, 119, 6, 0.28)",
      strokeWidth: 0.06,
      strokeDash: [0.05, 0.05],
    }),
    {
      lines: [
        {
          points: [
            { x: -2, y: 0 },
            { x: 2, y: 0 },
          ],
          strokeColor: "#dc2626",
          strokeWidth: 0.045,
          strokeDash: [0.08, 0.08],
        },
        {
          points: [
            { x: -0.11, y: -0.11 },
            { x: 0.11, y: 0.11 },
          ],
          strokeColor: "#dc2626",
          strokeWidth: 0.055,
        },
        {
          points: [
            { x: -0.11, y: 0.11 },
            { x: 0.11, y: -0.11 },
          ],
          strokeColor: "#dc2626",
          strokeWidth: 0.055,
        },
      ],
    },
    getRouteGraphics({
      route: simplifiedRoute,
      strokeColor: "#16803c",
      strokeWidth: 0.14,
      pointFill: "#dcfce7",
    }),
    immutableGraphics,
  )

  const renderPanel = (graphics: GraphicsObject) =>
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 560,
      svgHeight: 420,
      hideInlineLabels: true,
    })

  expect(
    stackSvgsHorizontally(
      [
        addPanelHeader({
          svg: renderPanel(inputGraphics),
          title: "BEFORE • UNSIMPLIFIED EDITABLE ROUTE",
          details: [
            "9 orange points are eligible for simplification.",
            "Gray dashed copper is pre-routed and read-only.",
          ],
        }),
        addPanelHeader({
          svg: renderPanel(outputGraphics),
          title: "AFTER • SIMPLIFIED AROUND FIXED COPPER",
          details: [
            "5 green points remain (4 removed); faint orange = input.",
            "Red direct shortcut was rejected; gray copper is unchanged.",
          ],
        }),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "immutable-routed-peer",
  })
})

test("via removal keeps a layer detour that crosses an immutable route", () => {
  const routeWithLayerDetour: HighDensityRoute = {
    connectionName: "editable",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ],
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["fixed", "fixed_piece"]])
  const runViaRemoval = (otherHdRoutes: HighDensityRoute[] = []) => {
    const solver = new UselessViaRemovalSolver({
      unsimplifiedHdRoutes: [structuredClone(routeWithLayerDetour)],
      otherHdRoutes,
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      connMap,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    return solver.getOptimizedHdRoutes()!
  }

  expect(runViaRemoval()[0]!.vias).toHaveLength(0)
  const immutableSnapshot = structuredClone(immutableRoute)
  const guardedRoutes = runViaRemoval([immutableRoute])
  expect(guardedRoutes).toHaveLength(1)
  expect(guardedRoutes[0]!.vias).toHaveLength(2)
  expect(immutableRoute).toEqual(immutableSnapshot)
})

test("same-net via merging collision-checks immutable routes without emitting them", () => {
  const makeViaRoute = (
    connectionName: string,
    viaX: number,
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: viaX - 0.25, y: 0, z: 0 },
      { x: viaX, y: 0, z: 0 },
      { x: viaX, y: 0, z: 1 },
      { x: viaX - 0.25, y: 0, z: 1 },
    ],
    vias: [{ x: viaX, y: 0 }],
  })
  const inputRoutes = [
    makeViaRoute("editable_a", -0.25),
    makeViaRoute("editable_b", 0.25),
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["editable_a", "editable_b"],
    ["fixed", "fixed_piece"],
  ])
  const runViaMerge = (otherHdRoutes: HighDensityRoute[] = []) => {
    const solver = new SameNetViaMergerSolver({
      inputHdRoutes: structuredClone(inputRoutes),
      otherHdRoutes,
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      connMap,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    return solver.getMergedViaHdRoutes()!
  }
  const countViaLocations = (routes: HighDensityRoute[]) =>
    new Set(
      routes.flatMap((route) => route.vias.map((via) => `${via.x}:${via.y}`)),
    ).size

  expect(countViaLocations(runViaMerge())).toBe(1)
  const immutableSnapshot = structuredClone(immutableRoute)
  const guardedRoutes = runViaMerge([immutableRoute])
  expect(guardedRoutes).toHaveLength(2)
  expect(countViaLocations(guardedRoutes)).toBe(2)
  expect(immutableRoute).toEqual(immutableSnapshot)
})
