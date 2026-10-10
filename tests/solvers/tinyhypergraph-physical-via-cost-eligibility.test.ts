import { expect, test } from "bun:test"
import { shouldUsePhysicalViaCost } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteConnection } from "lib/types"

test("physical via costs count merged original connections rather than fanout branches", (): void => {
  const originalConnectionNames = Array.from(
    { length: 100 },
    (_, index) => `original_${index}`,
  )
  const mergedConnections: SimpleRouteConnection[] = [
    {
      name: "merged_mst0",
      __rootConnectionNames: originalConnectionNames,
      pointsToConnect: [],
    },
    {
      name: "merged_mst1",
      __rootConnectionNames: originalConnectionNames,
      pointsToConnect: [],
    },
  ]
  expect(
    shouldUsePhysicalViaCost({
      connections: mergedConnections,
      layerCount: 2,
      hasPreloadedTraceOccupancy: false,
    }),
  ).toBeTrue()
  for (const context of [
    { layerCount: 4, hasPreloadedTraceOccupancy: false },
    { layerCount: 2, hasPreloadedTraceOccupancy: true },
  ]) {
    expect(
      shouldUsePhysicalViaCost({ connections: mergedConnections, ...context }),
    ).toBeFalse()
  }

  const powerFanoutConnections: SimpleRouteConnection[] = Array.from(
    { length: 150 },
    (_, index) => ({
      name: `power_mst${index}`,
      __rootConnectionNames: ["power"],
      pointsToConnect: [],
    }),
  )
  expect(
    shouldUsePhysicalViaCost({
      connections: powerFanoutConnections,
      layerCount: 2,
      hasPreloadedTraceOccupancy: false,
    }),
  ).toBeFalse()
})
