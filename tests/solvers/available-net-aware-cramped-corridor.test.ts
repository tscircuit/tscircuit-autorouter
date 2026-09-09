import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"

test("Available supplies original owned corridor ports with real graph incidences before Tiny search", (): void => {
  const fixture = createAvailableNetAwareCrampedPorts()
  const { input, srj, connMap, canonicalRouteNetId } = fixture
  const nodesBefore = structuredClone(input.nodes)
  const edgesBefore = structuredClone(input.edges)
  const rectanglesBefore = structuredClone(
    input.physicalCrampedPortContext.rectangles,
  )
  const legacy = new AvailableSegmentPointSolver({
    ...input,
    physicalCrampedPortContext: undefined,
  })
  legacy.solve()
  const solver = new AvailableSegmentPointSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const left = solver.edgeSegmentMap.get("left-turn")!
  const upper = solver.edgeSegmentMap.get("upper-turn")!
  expect(left.start).toEqual({ x: 0.25, y: 0.25 })
  expect(left.end).toEqual({ x: 0.25, y: 0.75 })
  const topLeft = left.portPoints.filter(
    (port): boolean => port.availableZ[0] === 0,
  )
  const topUpper = upper.portPoints.filter(
    (port): boolean => port.availableZ[0] === 0,
  )
  expect(topLeft.map((port): number => port.y)).toEqual([0.3125, 0.6875])
  expect(topUpper.map((port): number => port.x)).toEqual([0.3125, 0.6875])
  for (const segment of [left, upper]) {
    expect(segment.portPoints).toHaveLength(3)
    expect(
      segment.portPoints.filter((port): boolean => port.availableZ[0] === 1),
    ).toEqual(
      legacy.edgeSegmentMap
        .get(segment.edgeId)!
        .portPoints.filter((port): boolean => port.availableZ[0] === 1),
    )
    for (const port of segment.portPoints) {
      expect(port.cramped).toBeTrue()
      expect(port.physicalCutId).toBeUndefined()
      expect(port.connectionName).toBeNull()
      expect(port.nodeIds).toEqual(segment.nodeIds)
      expect(solver.portPointMap.get(port.segmentPortPointId)).toBe(port)
    }
  }
  const allPorts = solver
    .getOutput()
    .flatMap((segment): typeof segment.portPoints => segment.portPoints)
  expect(
    new Set(allPorts.map((port): string => port.segmentPortPointId)).size,
  ).toBe(allPorts.length)
  const built = buildHyperGraph({
    simpleRouteJsonConnections: srj.connections,
    capacityMeshNodes: input.nodes,
    segmentPortPoints: allPorts,
    layerCount: srj.layerCount,
    connectivityMap: connMap,
  })
  expect(built.connections).toHaveLength(3)
  for (const port of [...topLeft, ...topUpper]) {
    const represented = built.graph.ports.filter(
      (candidate): boolean =>
        candidate.d.portId === `${port.segmentPortPointId}::0`,
    )
    expect(represented).toHaveLength(1)
    const graphPort = represented[0]!
    expect(graphPort.region1.regionId).toBe(port.nodeIds[0])
    expect(graphPort.region2.regionId).toBe(port.nodeIds[1])
    expect(graphPort.region1.ports.includes(graphPort)).toBeTrue()
    expect(graphPort.region2.ports.includes(graphPort)).toBeTrue()
    expect(graphPort.d.cramped).toBeTrue()
  }
  const route = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0.25, z: 0 },
    { x: topLeft[0]!.x, y: topLeft[0]!.y, z: 0 },
    { x: topUpper[1]!.x, y: topUpper[1]!.y, z: 0 },
    { x: 0.75, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ]
  for (let index = 1; index < route.length; index++) {
    expect(
      input.physicalCrampedPortContext.clearanceIndex.isSegmentClear({
        start: route[index - 1]!,
        end: route[index]!,
        canonicalNetId: canonicalRouteNetId,
        copperDiameter: input.traceWidth,
      }),
    ).toBeTrue()
  }
  expect(input.nodes).toEqual(nodesBefore)
  expect(input.edges).toEqual(edgesBefore)
  expect(input.physicalCrampedPortContext.rectangles).toEqual(rectanglesBefore)
})
