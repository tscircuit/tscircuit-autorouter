import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { retainRoutesWithoutNewCopperContacts } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/retainRoutesWithoutNewCopperContacts"
import type { HighDensityRoute } from "lib/types/high-density-types"

const createRoute = ({
  connectionName,
  x,
  middleX,
}: {
  connectionName: string
  x: number
  middleX: number
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x, y: 0, z: 0 },
    { x: middleX, y: 1, z: 0 },
    { x: middleX, y: 3, z: 0 },
    { x, y: 4, z: 0 },
  ],
})

test("regional force improvement preserves safe moves and rejects cascading contacts", () => {
  const originalRoutes = [
    createRoute({ connectionName: "a", x: 0, middleX: 0 }),
    createRoute({ connectionName: "b", x: 2, middleX: 2 }),
    createRoute({ connectionName: "c", x: 4, middleX: 4 }),
    createRoute({ connectionName: "d", x: 6, middleX: 6.5 }),
  ]
  const candidateRoutes = [
    createRoute({ connectionName: "a", x: 0, middleX: 2 }),
    createRoute({ connectionName: "b", x: 2, middleX: 5 }),
    createRoute({ connectionName: "c", x: 4, middleX: 5 }),
    createRoute({ connectionName: "d", x: 6, middleX: 6 }),
  ]
  const originalCopy = structuredClone(originalRoutes)
  const candidateCopy = structuredClone(candidateRoutes)
  const routes = retainRoutesWithoutNewCopperContacts({
    originalRoutes,
    candidateRoutes,
    connMap: new ConnectivityMap({}),
  })
  expect(routes[0]).toBe(originalRoutes[0])
  expect(routes[1]).toBe(originalRoutes[1])
  expect(routes[2]).toBe(originalRoutes[2])
  expect(routes[3]).toBe(candidateRoutes[3])
  expect(originalRoutes).toEqual(originalCopy)
  expect(candidateRoutes).toEqual(candidateCopy)
  expect(
    retainRoutesWithoutNewCopperContacts({
      originalRoutes,
      candidateRoutes,
      connMap: new ConnectivityMap({ shared: ["a", "b", "c"] }),
    }),
  ).toEqual(candidateRoutes)
})
