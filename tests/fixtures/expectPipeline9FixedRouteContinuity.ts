import { expect } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]
type RouteVia = HighDensityRoute["vias"][number]
type FixedRouteContinuityInput = {
  connectionName: string
  originalFixedRoutes: PreloadedHighDensityRoute[]
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  replacement: PreloadedHighDensityRoute | undefined
  mutationMask: readonly boolean[] | undefined
  layerCount: number
}

export const expectPipeline9FixedRouteContinuity = ({
  connectionName,
  originalFixedRoutes,
  updatedFixedRoutes,
  replacement,
  mutationMask,
  layerCount,
}: FixedRouteContinuityInput): void => {
  const original: PreloadedHighDensityRoute | undefined =
    originalFixedRoutes.find(
      (route: PreloadedHighDensityRoute): boolean =>
        route.connectionName === connectionName,
    )
  expect(original).toBeDefined()
  const updated: PreloadedHighDensityRoute[] = updatedFixedRoutes.filter(
    (route: PreloadedHighDensityRoute): boolean =>
      route.connectionName === connectionName,
  )
  expect(updated).toHaveLength(1)
  if (!replacement) {
    expect(updated[0]).toEqual(original!)
    expect(mutationMask).toBeUndefined()
    return
  }

  expect(updated[0]).toEqual(replacement)
  expect(replacement.connectionName).toBe(connectionName)
  expect(replacement.rootConnectionName).toBe(original!.rootConnectionName)
  expect(replacement.preloadedTraceIndex).toBe(original!.preloadedTraceIndex)
  expect(replacement.preloadedRouteIndex).toBe(original!.preloadedRouteIndex)
  expect(Number.isFinite(replacement.preloadedRoutePositionStart)).toBeTrue()
  expect(Number.isFinite(replacement.preloadedRoutePositionEnd)).toBeTrue()
  const startPosition: number = replacement.preloadedRoutePositionStart!
  const endPosition: number = replacement.preloadedRoutePositionEnd!
  expect(startPosition).toBeLessThanOrEqual(endPosition)
  const representedRoutes: PreloadedHighDensityRoute[] = originalFixedRoutes
    .filter((route: PreloadedHighDensityRoute): boolean => {
      if (route.preloadedTraceIndex !== replacement.preloadedTraceIndex) {
        return false
      }
      expect(Number.isFinite(route.preloadedRoutePositionStart)).toBeTrue()
      expect(Number.isFinite(route.preloadedRoutePositionEnd)).toBeTrue()
      return (
        route.preloadedRoutePositionStart! >= startPosition &&
        route.preloadedRoutePositionEnd! <= endPosition
      )
    })
    .sort(
      (
        left: PreloadedHighDensityRoute,
        right: PreloadedHighDensityRoute,
      ): number => left.preloadedRouteIndex - right.preloadedRouteIndex,
    )
  expect(representedRoutes.length).toBeGreaterThan(0)
  const firstSource: PreloadedHighDensityRoute = representedRoutes[0]!
  const lastSource: PreloadedHighDensityRoute = representedRoutes.at(-1)!
  expect(firstSource.connectionName).toBe(connectionName)
  expect(firstSource.preloadedRoutePositionStart).toBe(startPosition)
  expect(lastSource.preloadedRoutePositionEnd).toBe(endPosition)
  expect(replacement.route.length).toBeGreaterThanOrEqual(2)
  expect(replacement.route[0]).toMatchObject(firstSource.route[0]!)
  expect(replacement.route.at(-1)).toMatchObject(lastSource.route.at(-1)!)
  expect(Number.isFinite(replacement.traceThickness)).toBeTrue()
  expect(replacement.traceThickness).toBeGreaterThan(0)
  expect(replacement.traceThickness).toBe(
    Math.max(
      ...representedRoutes.map(
        (route: PreloadedHighDensityRoute): number => route.traceThickness,
      ),
    ),
  )
  expect(Number.isFinite(replacement.viaDiameter)).toBeTrue()
  expect(replacement.viaDiameter).toBeGreaterThan(0)
  expect(replacement.viaDiameter).toBe(
    Math.max(
      ...representedRoutes.map(
        (route: PreloadedHighDensityRoute): number => route.viaDiameter,
      ),
    ),
  )

  for (const point of replacement.route) {
    const width: number = point.traceThickness ?? replacement.traceThickness
    expect(Number.isFinite(point.x)).toBeTrue()
    expect(Number.isFinite(point.y)).toBeTrue()
    expect(Number.isInteger(point.z)).toBeTrue()
    expect(point.z).toBeGreaterThanOrEqual(0)
    expect(point.z).toBeLessThan(layerCount)
    expect(Number.isFinite(width)).toBeTrue()
    expect(width).toBeGreaterThan(0)
  }
  for (
    let pointIndex: number = 1;
    pointIndex < replacement.route.length;
    pointIndex++
  ) {
    const previous: RoutePoint = replacement.route[pointIndex - 1]!
    const point: RoutePoint = replacement.route[pointIndex]!
    if (previous.z === point.z) continue
    expect(point.x).toBe(previous.x)
    expect(point.y).toBe(previous.y)
    expect(
      replacement.vias.some(
        (via: RouteVia): boolean => via.x === point.x && via.y === point.y,
      ),
    ).toBeTrue()
  }
  for (const via of replacement.vias) {
    expect(Number.isFinite(via.x)).toBeTrue()
    expect(Number.isFinite(via.y)).toBeTrue()
    expect(
      replacement.route.some((point: RoutePoint, index: number): boolean => {
        const previous: RoutePoint | undefined = replacement.route[index - 1]
        return (
          previous !== undefined &&
          previous.z !== point.z &&
          point.x === via.x &&
          point.y === via.y &&
          previous.x === via.x &&
          previous.y === via.y
        )
      }),
    ).toBeTrue()
  }

  expect(mutationMask).toBeDefined()
  expect(mutationMask).toHaveLength(replacement.route.length - 1)
  expect(
    mutationMask!.every(
      (mutated: boolean): boolean => typeof mutated === "boolean",
    ),
  ).toBeTrue()
  expect(
    mutationMask!.some((mutated: boolean, segmentIndex: number): boolean => {
      const start: RoutePoint = replacement.route[segmentIndex]!
      const end: RoutePoint = replacement.route[segmentIndex + 1]!
      return (
        mutated && (start.x !== end.x || start.y !== end.y || start.z !== end.z)
      )
    }),
  ).toBeTrue()
}
