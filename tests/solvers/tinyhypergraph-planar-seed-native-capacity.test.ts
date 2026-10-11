import { expect, test } from "bun:test"
import { createPlanarSeedFixture, createPlanarSeedTestSolver, getPlanarSeedBoundaryPorts } from "../fixtures/tinyhypergraph-planar-seed"

test("planar initialization leaves a foreign net pending rather than using duplicated, cramped or different-layer slots", (): void => {
  const { graph, segments } = createPlanarSeedFixture()
  const duplicate = graph.ports.find(({ portId }) => portId === "boundary-top")!
  duplicate.d!.duplicatedFromPortId = "boundary-bottom"
  duplicate.d!.tinyHypergraphPortPenalty = 150
  graph.ports.push({ portId: "boundary-cramped", region1Id: "left", region2Id: "right", d: { x: 0, y: 0, z: 0, tinyHypergraphPortPenalty: 2 } })
  graph.regions.find(({ regionId }) => regionId === "left")!.pointIds.push("boundary-cramped")
  graph.regions.find(({ regionId }) => regionId === "right")!.pointIds.push("boundary-cramped")
  for (const segment of segments) {
    if (segment.fromPortId === "boundary-top") segment.fromPortId = "boundary-bottom"
    if (segment.toPortId === "boundary-top") segment.toPortId = "boundary-bottom"
  }
  const solver = createPlanarSeedTestSolver(graph)
  const pendingBefore = [...solver.state.unroutedRoutes]
  solver.initializePlanarSeed(segments)

  expect(solver.state.unroutedRoutes).toHaveLength(1)
  expect(solver.state.unroutedRoutes).toEqual(pendingBefore.filter((routeId) => solver.state.unroutedRoutes.includes(routeId)))
  const selected = pendingBefore.find((routeId) => !solver.state.unroutedRoutes.includes(routeId))!
  const boundaryPorts = getPlanarSeedBoundaryPorts(solver, selected)
  expect(boundaryPorts).toHaveLength(1)
  expect(solver.topology.portMetadata![boundaryPorts[0]].serializedPortId).toBe("boundary-bottom")
  const pending = solver.state.unroutedRoutes[0]
  expect(solver.state.portAssignment[boundaryPorts[0]]).toBe(solver.problem.routeNet[selected])
  expect(solver.state.portAssignment[boundaryPorts[0]]).not.toBe(solver.problem.routeNet[pending])
  expect(solver.state.regionSegments.flat().filter(([routeId]) => routeId === selected)).toHaveLength(2)
  for (const [, fromPortId, toPortId] of solver.state.regionSegments.flat()) {
    for (const portId of [fromPortId, toPortId]) {
      expect(solver.topology.portMetadata![portId].duplicatedFromPortId).toBeUndefined()
      expect(solver.problem.portPenalty?.[portId] ?? 0).toBe(0)
      expect(solver.topology.portZ[portId]).toBe(0)
    }
  }
  for (let portId = 0; portId < solver.topology.portCount; portId++) {
    const id = solver.topology.portMetadata![portId].serializedPortId
    if (id === "boundary-top" || id === "boundary-cramped" || id === "boundary-other-layer") expect(solver.state.portAssignment[portId]).toBe(-1)
  }
})
