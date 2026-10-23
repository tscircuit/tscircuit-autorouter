import { expect, test } from "bun:test"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import { moveElectricalTreeJunction } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/moveElectricalTreeJunction"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("source SRJ terminals remain immutable without PCB pad identities while shared junctions can move", (): void => {
  const connections: SimpleRouteConnection[] = [
    { name: "ab", nominalTraceWidth: 0.1, pointsToConnect: [{ x: -2, y: 0, layer: "top", pointId: "A" }, { x: 2, y: 0, layer: "top", pointId: "B" }] },
    { name: "cb", nominalTraceWidth: 0.2, pointsToConnect: [{ x: 0, y: 2, layer: "top", pointId: "C" }, { x: 2, y: 0, layer: "top", pointId: "B" }] },
  ]
  const a: PortPoint = { portPointId: "a", electricalVertexId: "A", x: -2, y: 0, z: 0, connectionName: "ab", rootConnectionName: "bus" }
  const j: PortPoint = { portPointId: "j", electricalVertexId: "J", x: 0, y: 0, z: 0, connectionName: "ab", rootConnectionName: "bus" }
  const b: PortPoint = { portPointId: "b", electricalVertexId: "B", x: 2, y: 0, z: 0, connectionName: "ab", rootConnectionName: "bus" }
  const c: PortPoint = { portPointId: "c", electricalVertexId: "C", x: 0, y: 2, z: 0, connectionName: "cb", rootConnectionName: "bus" }
  const pairs: Array<[PortPoint, PortPoint]> = [[a, j], [j, b], [c, { ...j, connectionName: "cb" }], [{ ...j, connectionName: "cb" }, { ...b, connectionName: "cb" }]]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cell", center: { x: 0, y: 1 }, width: 6, height: 4, availableZ: [0], portPoints: pairs.flat(), portPointsInPairs: pairs }
  const input = { nodes: [node], connections, netByConnection: new Map([["ab", "bus"], ["cb", "bus"]]), excludedConnections: new Set<string>(),
    demandEndpoints: new Map<string, readonly [string, string]>([["ab", ["A", "B"]], ["cb", ["C", "B"]]]), layerCount: 2 }
  const compiled = compileSharedElectricalTrees(input)
  expect(compiled.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(compiled.connections).toHaveLength(3)
  const terminals = compiled.connections.flatMap((connection) => Object.values(connection.electricalBranch!.originalTerminals ?? {}))
  expect(terminals).toHaveLength(3)
  expect(terminals.map((entry) => entry.sourceConnectionName).sort()).toEqual(["ab", "ab", "cb"])
  expect(compiled.connections.flatMap((connection) => connection.pointsToConnect).filter((point) => ["A", "B", "C"].includes(point.pointId!))).toHaveLength(3)
  expect(compiled.nodesWithPortPoints.flatMap((entry) => entry.portPoints).every((point) => point.pcb_port_id === undefined)).toBe(true)
  const routes: HighDensityRoute[] = compiled.connections.map((connection) => ({ connectionName: connection.name, rootConnectionName: "bus",
    traceThickness: connection.nominalTraceWidth!, viaDiameter: 0.3, route: connection.pointsToConnect.map((point) => ({ x: point.x, y: point.y, z: 0 })), vias: [] }))
  expect(() => assertSharedElectricalTreeRoutes({ connections: compiled.connections, routes, layerCount: 2 })).not.toThrow()
  const moved = moveElectricalTreeJunction({ connections: compiled.connections, routes, layerCount: 2, vertexId: "J", dx: 0.1, dy: 0.2 })
  expect(moved).toBeDefined()
  expect(() => assertSharedElectricalTreeRoutes({ connections: compiled.connections, routes: moved!, layerCount: 2 })).not.toThrow()
  expect(moveElectricalTreeJunction({ connections: compiled.connections, routes, layerCount: 2, vertexId: "A", dx: 0.1, dy: 0 })).toBeUndefined()
  const walks = createElectricalTreeRepairWalks({ connections: compiled.connections, routes, layerCount: 2 })
  expect(walks.routes).toHaveLength(1)
  expect(walks.junctionCount).toBe(1)
  const physicalTerminals = [[-2, 0], [2, 0], [0, 2]]
  for (let walk = 0; walk < walks.routes.length; walk++) {
    for (let point = 0; point < walks.routes[walk]!.route.length; point++) {
      const position = walks.routes[walk]!.route[point]!
      if (physicalTerminals.some(([x, y]) => position.x === x && position.y === y)) expect(walks.lockedPointIndices[walk]![point]).toBe(true)
    }
  }
  const movedWalks = structuredClone(walks.routes)
  for (const route of movedWalks) for (const point of route.route) if (point.x === 0 && point.y === 0) { point.x = 0.1; point.y = 0.2 }
  const decoded = walks.decode(movedWalks)
  expect(() => assertSharedElectricalTreeRoutes({ connections: compiled.connections, routes: decoded, layerCount: 2 })).not.toThrow()
  expect(decoded.flatMap((route) => route.route).filter((point) => point.x === 0.1 && point.y === 0.2)).toHaveLength(3)
  const movedTerminal = structuredClone(walks.routes)
  for (const route of movedTerminal) for (const point of route.route) if (point.x === -2 && point.y === 0) point.x += 0.01
  expect(() => walks.decode(movedTerminal)).toThrow("moved immutable terminal")
  const corrupted = structuredClone(compiled.connections)
  const fixed = corrupted.find((connection) => connection.electricalBranch?.originalTerminals?.start || connection.electricalBranch?.originalTerminals?.end)!.electricalBranch!.originalTerminals!
  const witness = fixed.start ?? fixed.end!
  witness.x += 0.01
  expect(() => assertSharedElectricalTreeRoutes({ connections: corrupted, routes, layerCount: 2 })).toThrow("lost original terminal witness")
  for (const change of ["identity", "missing-identity", "layer", "z"] as const) {
    const invalid = structuredClone(compiled.connections)
    const terminal = invalid.find((connection) => connection.electricalBranch?.originalTerminals?.start || connection.electricalBranch?.originalTerminals?.end)!.electricalBranch!.originalTerminals!
    const value = terminal.start ?? terminal.end!
    if (change === "identity") value.sourcePointId = "foreign-source-point"
    if (change === "missing-identity") Reflect.deleteProperty(value, "sourcePointId")
    if (change === "layer") value.layer = "bottom"
    if (change === "z") value.z = 1
    expect(() => assertSharedElectricalTreeRoutes({ connections: invalid, routes, layerCount: 2 })).toThrow("lost original terminal witness")
  }
  const malformedSource = structuredClone(connections)
  malformedSource[0]!.pointsToConnect[0]!.x += 0.01
  expect(() => compileSharedElectricalTrees({ ...input, connections: malformedSource })).toThrow("changed original terminal")
  const mismatchedPad = structuredClone(connections)
  mismatchedPad[0]!.pointsToConnect[0]!.pcb_port_id = "source-pad-A"
  expect(() => compileSharedElectricalTrees({ ...input, connections: mismatchedPad })).toThrow("changed original terminal")
  const native = compileSharedElectricalTrees({ ...input, nativeNetIds: new Set(["bus"]) })
  const nativeRoutes: HighDensityRoute[] = native.connections.map((connection) => ({ connectionName: connection.name, rootConnectionName: "bus",
    traceThickness: connection.nominalTraceWidth!, viaDiameter: 0.3, route: connection.pointsToConnect.map((point) => ({ x: point.x, y: point.y, z: 0 })), vias: [] }))
  expect(native.connections.every((connection) => connection.electricalBranch?.nativeLogicalPath)).toBe(true)
  expect(moveElectricalTreeJunction({ connections: native.connections, routes: nativeRoutes, layerCount: 2, vertexId: "B", dx: 0.1, dy: 0 })).toBeUndefined()
  const nativeWalks = createElectricalTreeRepairWalks({ connections: native.connections, routes: nativeRoutes, layerCount: 2 })
  expect(nativeWalks.routes).toHaveLength(2)
  for (const locks of nativeWalks.lockedPointIndices) expect(locks).toEqual([true, true])
  expect(() => nativeWalks.decode(nativeWalks.routes)).not.toThrow()
  const namelessSources = connections.map((connection) => ({ ...connection, pointsToConnect: connection.pointsToConnect.map((point) => ({ ...point, pointId: undefined })) }))
  const nameless = compileSharedElectricalTrees({ ...input, connections: namelessSources })
  expect(nameless.connections.flatMap((connection) => Object.values(connection.electricalBranch!.originalTerminals ?? {})).every((terminal) => terminal.sourcePointId === null)).toBe(true)
  expect(() => createElectricalTreeRepairWalks({ connections: nameless.connections, routes, layerCount: 2 })).not.toThrow()
  // One already certified physical vertex can be referenced by several
  // original demands. Different source labels must not unfix that vertex.
  const aliasSources = structuredClone(connections)
  aliasSources[1]!.pointsToConnect[1]!.pointId = "B-alias"
  const beforeAliasSources = structuredClone(aliasSources)
  const aliases = compileSharedElectricalTrees({ ...input, connections: aliasSources })
  expect(aliases.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(aliasSources).toEqual(beforeAliasSources)
  const bBranch = aliases.connections.find((connection) => connection.electricalBranch!.startVertexId === "B" || connection.electricalBranch!.endVertexId === "B")!
  const fixedB = bBranch.electricalBranch!.startVertexId === "B" ? bBranch.electricalBranch!.originalTerminals!.start : bBranch.electricalBranch!.originalTerminals!.end
  expect(fixedB).toMatchObject({ x: 2, y: 0, z: 0, layer: "top" })
  const bottomPairs = pairs.map((pair) => pair.map((point) => ({ ...point, z: 1 })) as [PortPoint, PortPoint])
  const multilayerSources: SimpleRouteConnection[] = connections.map((connection) => ({ ...connection,
    pointsToConnect: connection.pointsToConnect.map(({ x, y, pointId }) => ({ x, y, pointId, layers: ["top", "bottom"] })) }))
  const bottom = compileSharedElectricalTrees({ ...input, connections: multilayerSources,
    nodes: [{ ...node, availableZ: [1], portPoints: bottomPairs.flat(), portPointsInPairs: bottomPairs }] })
  const bottomRoutes: HighDensityRoute[] = bottom.connections.map((connection) => ({ connectionName: connection.name, rootConnectionName: "bus",
    traceThickness: connection.nominalTraceWidth!, viaDiameter: 0.3, route: connection.pointsToConnect.map((point) => ({ x: point.x, y: point.y, z: 1 })), vias: [] }))
  expect(bottom.connections.flatMap((connection) => Object.values(connection.electricalBranch!.originalTerminals ?? {})).every((terminal) => terminal.z === 1 && terminal.layer === "bottom")).toBe(true)
  expect(() => createElectricalTreeRepairWalks({ connections: bottom.connections, routes: bottomRoutes, layerCount: 2 })).not.toThrow()
  expect(() => createElectricalTreeRepairWalks({ connections: bottom.connections, routes: bottomRoutes })).toThrow("requires the board layers")
  const nativeBottom = compileSharedElectricalTrees({ ...input, connections: multilayerSources, nativeNetIds: new Set(["bus"]),
    nodes: [{ ...node, availableZ: [1], portPoints: bottomPairs.flat(), portPointsInPairs: bottomPairs }] })
  const nativeBottomRoutes: HighDensityRoute[] = nativeBottom.connections.map((connection) => ({ connectionName: connection.name, rootConnectionName: "bus",
    traceThickness: connection.nominalTraceWidth!, viaDiameter: 0.3, route: connection.pointsToConnect.map((point) => ({ x: point.x, y: point.y, z: 1 })), vias: [] }))
  expect(nativeBottom.connections.every((connection) => connection.electricalBranch!.nativeLogicalPath && connection.pointsToConnect.every((point) => point.layer === "bottom"))).toBe(true)
  expect(multilayerSources.every((connection) => connection.pointsToConnect.every((point) => point.layers?.join(",") === "top,bottom"))).toBe(true)
  expect(() => assertSharedElectricalTreeRoutes({ connections: nativeBottom.connections, routes: nativeBottomRoutes, layerCount: 2 })).not.toThrow()
  const nativeBottomWalks = createElectricalTreeRepairWalks({ connections: nativeBottom.connections, routes: nativeBottomRoutes, layerCount: 2 })
  expect(nativeBottomWalks.lockedPointIndices).toEqual([[true, true], [true, true]])
  expect(() => nativeBottomWalks.decode(nativeBottomWalks.routes)).not.toThrow()
  const scene = { layerCount: 2, minTraceWidth: 0.1, obstacles: [], bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, connections: structuredClone(connections) }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scene, { cacheProvider: null })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(pipeline.portPointPathingSolver!.stats.electricalTreeVerifiedDemandCount).toBe(2)
  expect(() => assertSharedElectricalTreeRoutes({ connections: pipeline.getRoutingConnections(), routes: pipeline._getOutputHdRoutes(), layerCount: 2 })).not.toThrow()
  // Bare SRJ terminals have no Circuit JSON pad bodies: the board DRC
  // evaluator also reports their outer ends as disconnected on native b9.
  // The export contract here is the exact declared electrical endpoints.
  const exported = pipeline.getOutputSimplifiedPcbTraces()
  expect(exported.flatMap((trace) => trace.connectsTo ?? []).sort()).toEqual(["A", "B", "C", "C"])
  for (const expected of scene.connections.flatMap((connection) => connection.pointsToConnect)) {
    expect(exported.some((trace) => trace.route.some((point) => point.route_type === "wire" && point.x === expected.x && point.y === expected.y && point.layer === "top"))).toBe(true)
  }
})
