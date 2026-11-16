import assert from "node:assert/strict"

type RuntimeObject = Record<string, any>

function getConnectedIdentity(pipeline: RuntimeObject, ids: string[]): RuntimeObject {
  const netIds = ids.map(id =>
    pipeline.connMap.getNetConnectedToId(id) ?? (pipeline.connMap.netMap[id] ? id : null),
  )
  return {
    primaryConnectedId: ids[0] ?? null,
    connectedToIdentifierCount: ids.length,
    connectedNetIds: [...new Set(netIds.filter(id => id !== null))],
    unresolvedConnectedIdentifierCount: netIds.filter(id => id === null).length,
  }
}

/** Read the retained natural stage inputs; never rerun a getter or validator. */
export function getHighDensityPortContext(pipeline: RuntimeObject): RuntimeObject[] {
  const portId = "ce31890_pp0_z0_cramped::0"
  const edgeId = "ce31890"
  const edge = pipeline.capacityEdges.find((candidate: RuntimeObject) => candidate.capacityMeshEdgeId === edgeId)
  assert(edge, "Missing native H616 cramped-goal edge")
  const nodeIds = new Set<string>(edge.nodeIds)
  const uniform = pipeline.uniformPortDistributionSolver
  assert(uniform?.solved, "Native context requires the completed Uniform stage")
  const familyEntry = [...uniform.mapOfOwnerPairToPortPoints].find(([, points]) =>
    points.some((point: RuntimeObject) => point.portPointId === portId),
  )
  assert(familyEntry, "Missing native H616 uniform port family")
  const [ownerPairKey, completeFamilyAfter] = familyEntry
  const familyAfter = completeFamilyAfter.filter((point: RuntimeObject) => point.z === 0)
  const familyIds = new Set(familyAfter.map((point: RuntimeObject) => point.portPointId))
  const sharedEdge = uniform.mapOfOwnerPairToSharedEdge.get(ownerPairKey)
  assert(sharedEdge)
  const familyBefore = new Map<string, RuntimeObject>()
  for (const node of uniform.input.nodeWithPortPoints) {
    for (const point of node.portPoints) {
      if (familyIds.has(point.portPointId)) familyBefore.set(point.portPointId, point)
    }
  }
  const nodes = pipeline.capacityNodes
    .filter((node: RuntimeObject) => nodeIds.has(node.capacityMeshNodeId))
    .map((node: RuntimeObject) => {
      const { _parent, _connectedTo, ...metadata } = node
      return { ...metadata, parentNodeId: _parent?.capacityMeshNodeId ?? null, ...getConnectedIdentity(pipeline, _connectedTo ?? []) }
    })
  assert.equal(nodes.length, 2)
  const source = pipeline.originalSrj
  const witnessObstacles = source.obstacles.filter((obstacle: RuntimeObject) =>
    obstacle.obstacleId === "pcb_smtpad_610" ||
    obstacle.connectedTo[0] === "pcb_smtpad_610" ||
    obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_610",
  )
  assert.equal(witnessObstacles.length, 1)
  const boundaryObstacles = uniform.input.obstacles.filter((obstacle: RuntimeObject) => {
    const minX = obstacle.center.x - obstacle.width / 2
    const maxX = obstacle.center.x + obstacle.width / 2
    const minY = obstacle.center.y - obstacle.height / 2
    const maxY = obstacle.center.y + obstacle.height / 2
    return sharedEdge.orientation === "vertical"
      ? (Math.abs(sharedEdge.x1 - minX) < 1e-6 || Math.abs(sharedEdge.x1 - maxX) < 1e-6) && Math.min(sharedEdge.y2, maxY) - Math.max(sharedEdge.y1, minY) > 1e-6
      : (Math.abs(sharedEdge.y1 - minY) < 1e-6 || Math.abs(sharedEdge.y1 - maxY) < 1e-6) && Math.min(sharedEdge.x2, maxX) - Math.max(sharedEdge.x1, minX) > 1e-6
  })
  const tiny = pipeline.portPointPathingSolver.tinyPipelineSolver.getSolvedTinySolver()
  const selectedPortIds: number[] = []
  for (let id = 0; id < tiny.topology.portCount; id++) {
    if (tiny.topology.portMetadata[id]?.serializedPortId === portId) selectedPortIds.push(id)
  }
  const reservations = selectedPortIds.map((id: number) => ({
    portId: id,
    metadata: tiny.topology.portMetadata[id],
    x: tiny.topology.portX[id], y: tiny.topology.portY[id], z: tiny.topology.portZ[id],
    assignedNetId: tiny.state.portAssignment[id],
    endpointReservedNetId: tiny.problemSetup.portEndpointReservationNetId[id],
    incidentRegionIds: tiny.topology.incidentPortRegion[id],
  }))
  const routeIds = new Set<number>()
  const chosenSegments: RuntimeObject[] = []
  for (let regionId = 0; regionId < tiny.state.regionSegments.length; regionId++) {
    for (const [routeId, from, to] of tiny.state.regionSegments[regionId]) {
      if (!selectedPortIds.includes(from) && !selectedPortIds.includes(to)) continue
      routeIds.add(routeId)
      chosenSegments.push({ regionId, capacityMeshNodeId: tiny.topology.regionMetadata[regionId]?.capacityMeshNodeId, routeId, from, to })
    }
  }
  const componentIds = new Set(witnessObstacles.map((obstacle: RuntimeObject) => obstacle.componentId).filter(Boolean))
  const topologyOrigins = pipeline.topologyMergingSolver.inputProblem.nodeGroups.flatMap((group: RuntimeObject) =>
    group.nodes.filter((node: RuntimeObject) => nodes.some((selected: RuntimeObject) =>
      Math.abs(node.center.x - selected.center.x) <= node.width / 2 + 1e-9 &&
      Math.abs(node.center.y - selected.center.y) <= node.height / 2 + 1e-9 &&
      node.availableZ.some((z: number) => selected.availableZ.includes(z)),
    )).map((node: RuntimeObject) => {
      const { _parent, _connectedTo, ...metadata } = node
      return { groupId: group.groupId, isComponent: group.isComponent, node: metadata, parentNodeId: _parent?.capacityMeshNodeId ?? null, ...getConnectedIdentity(pipeline, _connectedTo ?? []) }
    }),
  )
  const uniformContext = {
    contextType: "h616-uniform-family",
    portId,
    familyScope: "complete target-layer z0 family; other layers counted separately",
    familyCountsByLayer: Object.fromEntries([...new Set<number>(completeFamilyAfter.map((point: RuntimeObject) => point.z))].map(z => [z, completeFamilyAfter.filter((point: RuntimeObject) => point.z === z).length])),
    preUniformSource: "actual retained P9 constructor handoff from portPointPathingSolver.getOutput()",
    ownerPairKey, sharedEdge,
    familyPointFields: ["portPointId", "x", "y", "z", "connectionName", "rootConnectionName", "pcb_port_id"],
    familyBefore: [...familyBefore.values()].map(point => [point.portPointId, point.x, point.y, point.z, point.connectionName, point.rootConnectionName, point.pcb_port_id ?? null]),
    familyAfter: familyAfter.map((point: RuntimeObject) => [point.portPointId, point.x, point.y, point.z, point.connectionName, point.rootConnectionName, point.pcb_port_id ?? null]),
    useLayerAwareGeometry: uniform.input.useLayerAwareGeometry,
    preserveSolitaryPorts: uniform.input.preserveSolitaryPorts,
    hasPortClearValidator: typeof uniform.input.isPortPointClear === "function",
    boundaryObstacles: boundaryObstacles.map((obstacle: RuntimeObject) => {
      const { connectedTo, ...geometry } = obstacle
      return { ...geometry, ...getConnectedIdentity(pipeline, connectedTo) }
    }),
  }
  const portContext = {
    contextType: "h616-port-topology",
    portId, edge, nodes,
    rawSharedSegment: pipeline.availableSegmentPointSolver.sharedEdgeSegments.find((segment: RuntimeObject) => segment.edgeId === edgeId),
    retainedSharedSegment: pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints.find((segment: RuntimeObject) => segment.edgeId === edgeId),
    goalBeforeUniform: familyBefore.get(portId),
    goalAfterUniform: familyAfter.find((point: RuntimeObject) => point.portPointId === portId),
    sourceRules: Object.fromEntries(["layerCount", "minTraceWidth", "defaultObstacleMargin", "minTraceToPadEdgeClearance", "minViaEdgeToPadEdgeClearance", "minPadEdgeToPadEdgeClearance", "minViaPadDiameter", "min_via_pad_diameter", "minViaHoleDiameter", "min_via_hole_diameter", "allowViaInPad", "allowBlindAndBuriedVias"].map(key => [key, source[key] ?? null])),
    sourceRuleNullMeaning: "field absent in the actual phase SRJ",
    effectiveTraceWidth: pipeline.minTraceWidth,
    witnessObstacles: witnessObstacles.map((obstacle: RuntimeObject) => {
      const { connectedTo, ...geometry } = obstacle
      return { ...geometry, ...getConnectedIdentity(pipeline, connectedTo) }
    }),
    connection: source.connections.find((connection: RuntimeObject) => connection.name === "source_net_116"),
    detectedComponents: pipeline.componentDetectionSolver.getOutput().filter((component: RuntimeObject) => componentIds.has(component.componentId)),
    topologyOriginsSelection: "actual merging-input nodes covering an adjacent output node center on a shared layer; not retained exact merger provenance",
    topologyOrigins,
    reservations, chosenSegments,
    chosenRoutes: [...routeIds].map(routeId => ({ routeId, netId: tiny.problem.routeNet[routeId], fixed: tiny.problem.routeIsFixed?.[routeId] ?? null, metadata: tiny.problem.routeMetadata[routeId] })),
  }
  return structuredClone([portContext, uniformContext])
}
