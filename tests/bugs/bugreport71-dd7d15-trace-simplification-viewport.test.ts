import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import bugReport from "../../fixtures/bug-reports/bugreport71-dd7d15/bugreport71-dd7d15.json" with {
  type: "json",
}

type Point = {
  x: number
  y: number
}

type DataPixelPair = {
  data: Point
  pixel: Point
}

type SectionView = {
  center: Point
  size: number
}

type RoutePoint = HighDensityRoute["route"][number]
type RouteVia = HighDensityRoute["vias"][number]

const srj = bugReport.simple_route_json as SimpleRouteJson
const globalDrcViaView: SectionView = {
  center: { x: 4.46, y: 25.5 },
  size: 10,
}

function cropSvgToSectionView(svg: string, sectionView: SectionView): string {
  const pairs: DataPixelPair[] = []
  const polylinePattern =
    /<polyline\b[^>]*\bdata-points="([^"]+)"[^>]*\bpoints="([^"]+)"/g

  for (const match of svg.matchAll(polylinePattern)) {
    const dataPoints = match[1]!.split(" ")
    const pixelPoints = match[2]!.split(" ")
    const pairCount = Math.min(dataPoints.length, pixelPoints.length)
    for (let pointIndex = 0; pointIndex < pairCount; pointIndex++) {
      const [dataX, dataY] = dataPoints[pointIndex]!.split(",").map(Number)
      const [pixelX, pixelY] = pixelPoints[pointIndex]!.split(",").map(Number)
      if (
        Number.isFinite(dataX) &&
        Number.isFinite(dataY) &&
        Number.isFinite(pixelX) &&
        Number.isFinite(pixelY)
      ) {
        pairs.push({
          data: { x: dataX!, y: dataY! },
          pixel: { x: pixelX!, y: pixelY! },
        })
      }
    }
  }

  if (pairs.length === 0) {
    throw new Error("Unable to infer SVG data-to-pixel transform")
  }

  const xPairA = pairs[0]!
  const xPairB = pairs.find(
    (pair) => Math.abs(pair.data.x - xPairA.data.x) > 1e-9,
  )
  const yPairA = pairs[0]!
  const yPairB = pairs.find(
    (pair) => Math.abs(pair.data.y - yPairA.data.y) > 1e-9,
  )

  if (!xPairB || !yPairB) {
    throw new Error("Unable to infer SVG data-to-pixel transform")
  }

  const scaleX =
    (xPairB.pixel.x - xPairA.pixel.x) / (xPairB.data.x - xPairA.data.x)
  const scaleY =
    (yPairB.pixel.y - yPairA.pixel.y) / (yPairB.data.y - yPairA.data.y)
  const offsetX = xPairA.pixel.x - scaleX * xPairA.data.x
  const offsetY = yPairA.pixel.y - scaleY * yPairA.data.y
  const halfSize = sectionView.size / 2
  const sectionLeft = sectionView.center.x - halfSize
  const sectionRight = sectionView.center.x + halfSize
  const sectionBottom = sectionView.center.y - halfSize
  const sectionTop = sectionView.center.y + halfSize
  const pixelLeft = scaleX * sectionLeft + offsetX
  const pixelRight = scaleX * sectionRight + offsetX
  const pixelBottom = scaleY * sectionBottom + offsetY
  const pixelTop = scaleY * sectionTop + offsetY
  const viewBoxX = Math.min(pixelLeft, pixelRight)
  const viewBoxY = Math.min(pixelBottom, pixelTop)
  const viewBoxWidth = Math.abs(pixelRight - pixelLeft)
  const viewBoxHeight = Math.abs(pixelTop - pixelBottom)

  return svg.replace(
    /viewBox="[^"]+"/,
    `viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}"`,
  )
}

function getRouteVias(route: HighDensityRoute): RoutePoint[] {
  const vias: RoutePoint[] = []

  for (let index = 0; index < route.route.length - 1; index++) {
    const current = route.route[index]
    const next = route.route[index + 1]
    if (!current || !next) continue
    if (current.z === next.z) continue
    if (
      Math.abs(current.x - next.x) > 1e-9 ||
      Math.abs(current.y - next.y) > 1e-9
    ) {
      continue
    }
    vias.push(current)
  }

  return vias
}

function getNearestVia(route: HighDensityRoute, point: Point): RoutePoint | null {
  let nearestVia: RoutePoint | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const via of getRouteVias(route)) {
    const distance = Math.hypot(via.x - point.x, via.y - point.y)
    if (distance < nearestDistance) {
      nearestVia = via
      nearestDistance = distance
    }
  }

  return nearestVia
}

function getNearestListedVia(
  route: HighDensityRoute,
  point: Point,
): RouteVia | null {
  let nearestVia: RouteVia | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const via of route.vias) {
    const distance = Math.hypot(via.x - point.x, via.y - point.y)
    if (distance < nearestDistance) {
      nearestVia = via
      nearestDistance = distance
    }
  }

  return nearestVia
}

function buildHdRouteGraphics(
  routes: HighDensityRoute[],
  inputSrj: SimpleRouteJson,
) {
  const baseGraphics = convertSrjToGraphicsObject(inputSrj)

  return {
    coordinateSystem: "cartesian" as const,
    rects: baseGraphics.rects ?? [],
    lines: routes.flatMap((route) => {
      const lines = []
      for (let index = 0; index < route.route.length - 1; index++) {
        const current = route.route[index]
        const next = route.route[index + 1]
        if (!current || !next || current.z !== next.z) continue
        lines.push({
          points: [
            { x: current.x, y: current.y },
            { x: next.x, y: next.y },
          ],
          strokeColor: current.z === 0 ? "red" : "blue",
          strokeWidth: route.traceThickness,
          label: `${route.connectionName} (z=${current.z})`,
        })
      }
      return lines
    }),
    circles: routes.flatMap((route) =>
      route.vias.map((via) => ({
        center: { x: via.x, y: via.y },
        radius: route.viaDiameter / 2,
        fill: "rgba(255, 0, 255, 0.5)",
        label: `${route.connectionName} via`,
      })),
    ),
  }
}

test("bugreport71 GlobalDrc keeps connMap same-net vias joined around 4.46,25.50", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solveUntilPhase("globalDrcForceImproveSolver")

  while (solver.getCurrentPhase() === "globalDrcForceImproveSolver") {
    solver.step()
    if (solver.failed) {
      throw new Error(solver.error ?? "GlobalDrc pipeline failed")
    }
  }

  const outputRoutes = solver._getOutputHdRoutes()
  const mst13 = outputRoutes.find(
    (route) => route.connectionName === "source_net_0_mst13",
  )
  const mst26 = outputRoutes.find(
    (route) => route.connectionName === "source_net_0_mst26",
  )
  expect(mst13).toBeDefined()
  expect(mst26).toBeDefined()

  const mst13Via = getNearestVia(mst13!, globalDrcViaView.center)
  const mst26Via = getNearestVia(mst26!, globalDrcViaView.center)
  const mst13ListedVia = getNearestListedVia(mst13!, globalDrcViaView.center)
  const mst26ListedVia = getNearestListedVia(mst26!, globalDrcViaView.center)
  expect(mst13Via).toBeDefined()
  expect(mst26Via).toBeDefined()
  expect(mst13ListedVia).toBeDefined()
  expect(mst26ListedVia).toBeDefined()
  expect(Math.hypot(mst13Via!.x - mst26Via!.x, mst13Via!.y - mst26Via!.y)).toBe(
    0,
  )
  expect(
    Math.hypot(
      mst13ListedVia!.x - mst26ListedVia!.x,
      mst13ListedVia!.y - mst26ListedVia!.y,
    ),
  ).toBe(0)
  expect(
    Math.hypot(mst13Via!.x - mst13ListedVia!.x, mst13Via!.y - mst13ListedVia!.y),
  ).toBeLessThan(0.001)
  expect(
    Math.hypot(mst26Via!.x - mst26ListedVia!.x, mst26Via!.y - mst26ListedVia!.y),
  ).toBeLessThan(0.001)

  const globalDrcGraphics = buildHdRouteGraphics(outputRoutes, srj)
  const nearbyVias = (globalDrcGraphics.circles ?? []).filter(
    (circle) =>
      Math.abs(circle.center.x - globalDrcViaView.center.x) <=
        globalDrcViaView.size / 2 &&
      Math.abs(circle.center.y - globalDrcViaView.center.y) <=
        globalDrcViaView.size / 2,
  )
  expect(nearbyVias.length).toBeGreaterThanOrEqual(2)

  const globalDrcSvg = getSvgFromGraphicsObject(
    globalDrcGraphics,
    { backgroundColor: "white" },
  )
  expect(
    cropSvgToSectionView(globalDrcSvg, globalDrcViaView),
  ).toMatchSvgSnapshot(import.meta.path)
})
