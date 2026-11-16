import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
type NodeId = string
type AliasHash = string
type Restore = () => void
type ObserverOptions = { onSnapshot?: (report: RuntimeObject) => void }

const TARGET_NODE_IDS = ["topology_merge_17108", "new-cmn_8-79__sub_3_0"]
const MAX_REPORT_BYTES = 512 * 1024

function summarize(serializable: unknown): RuntimeObject {
  const serialized = JSON.stringify(serializable)
  return {
    bytes: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  }
}

function selectFields(source: RuntimeObject, fields: string[]): RuntimeObject {
  return structuredClone(Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]])))
}

function solverSummary(solver: RuntimeObject): RuntimeObject {
  return {
    name: solver.getSolverName(), iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS, solved: solver.solved,
    failed: solver.failed, error: solver.error,
    stats: Object.fromEntries(Object.entries(solver.stats ?? {}).filter(([, count]) =>
      typeof count === "number" || typeof count === "boolean")),
  }
}

function cloneNode(node: RuntimeObject): RuntimeObject {
  return selectFields(node, ["capacityMeshNodeId", "center", "width", "height",
    "availableZ", "portPoints", "portPointsInPairs", "_containsTarget"])
}

function cloneRoute(route: RuntimeObject): RuntimeObject {
  return selectFields(route, ["connectionName", "rootConnectionName", "regionId",
    "traceThickness", "viaDiameter", "route", "vias", "isFixed", "isThroughObstacle",
    "preloadedTraceIndex", "preloadedRouteIndex", "preloadedRoutePositionStart",
    "preloadedRoutePositionEnd"])
}

function canonicalIdentity(connMap: RuntimeObject, route: RuntimeObject): RuntimeObject {
  return {
    connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
    canonicalRoots: [...new Set([route.connectionName, route.rootConnectionName]
      .filter((id) => typeof id === "string").map((id) =>
        connMap.getNetConnectedToId(id) ?? (Object.hasOwn(connMap.netMap, id) ? id : null))
      .filter((id) => id !== null))],
  }
}

function routeOverlapsWindow(route: RuntimeObject, window: RuntimeObject): boolean {
  const radius = Math.max(route.viaDiameter ?? 0, route.traceThickness ?? 0) / 2
  const points = [...route.route, ...(route.vias ?? [])]
  if (points.length === 0) return false
  return Math.min(...points.map((point) => point.x)) - radius <= window.maxX &&
    Math.max(...points.map((point) => point.x)) + radius >= window.minX &&
    Math.min(...points.map((point) => point.y)) - radius <= window.maxY &&
    Math.max(...points.map((point) => point.y)) + radius >= window.minY
}

function captureTinyContext(pipeline: RuntimeObject): RuntimeObject {
  const pathing = pipeline.portPointPathingSolver
  assert.equal(typeof pathing?.getSolvedTinySolver, "function", "Solved Tiny accessor unavailable")
  const tiny = pathing.getSolvedTinySolver()
  const { topology, problem, state } = tiny
  const regionIds = topology.regionMetadata.flatMap((metadata: RuntimeObject, index: number) =>
    metadata?.capacityMeshNodeId === TARGET_NODE_IDS[0] ? [index] : [])
  assert.equal(regionIds.length, 1, "Target Tiny region must be unique")
  const regionId = regionIds[0]
  const segments = state.regionSegments[regionId]
  assert(Array.isArray(segments) && segments.length <= 16, "Target Tiny segment scope exceeded")
  const portIds = [...new Set<number>(segments.flatMap((entry: number[]) => entry.slice(1, 3)))]
  return {
    capture: "Selected solved Tiny state before the first HD step; selected initial assignments are not necessarily the first coarse solver input",
    regionId, region: { centerX: topology.regionCenterX?.[regionId], centerY: topology.regionCenterY?.[regionId],
      width: topology.regionWidth?.[regionId], height: topology.regionHeight?.[regionId], availableZMask: topology.regionAvailableZMask?.[regionId] },
    regionMetadata: selectFields(topology.regionMetadata[regionId], ["capacityMeshNodeId", "serializedRegionId"]),
    segments: segments.map(([routeId, fromPortId, toPortId]: number[]) => ({
      routeId, fromPortId, toPortId, numericNet: problem.routeNet[routeId], routeIsFixed: problem.routeIsFixed[routeId],
      fromZ: topology.portZ[fromPortId], toZ: topology.portZ[toPortId],
      metadata: selectFields(problem.routeMetadata[routeId], ["connectionId", "mutuallyConnectedNetworkId", "preloadedTraceSection"]),
      identity: canonicalIdentity(pipeline.connMap, { connectionName: problem.routeMetadata[routeId].connectionId,
        rootConnectionName: problem.routeMetadata[routeId].mutuallyConnectedNetworkId }),
    })),
    ports: portIds.map((portId) => ({ portId, x: topology.portX[portId], y: topology.portY[portId], z: topology.portZ[portId],
      metadata: selectFields(topology.portMetadata[portId], ["serializedPortId", "portId", "_preloadedTracePortAssignments"]),
    })),
    selectedSegmentsSummary: summarize(segments),
    initialAssignments: structuredClone(problem.initialAssignments.filter((entry: RuntimeObject) => entry.regionId === regionId)),
  }
}

/** Observe one owned pipeline; every original method executes exactly once. */
export function createHighDensityPhaseObserver(options: ObserverOptions = {}): {
  afterPipelineStep: (pipeline: RuntimeObject) => void
  finish: (pipeline: RuntimeObject) => RuntimeObject
  dispose: () => void
  getReport: () => RuntimeObject
} {
  const restorations: Restore[] = []
  const aliasLists = new Map<AliasHash, RuntimeObject>()
  const nodeIndexes = new Map<NodeId, number>()
  const routeStarts = new Map<NodeId, number>()
  const scopedNodes = new Map<NodeId, RuntimeObject>()
  const regionalAttempts = new WeakMap<object, RuntimeObject>()
  let highDensity: RuntimeObject | undefined
  let finished = false
  let disposed = false
  let validation: { regional: RuntimeObject; call: number } | undefined
  const report: RuntimeObject = {
    instrumentation: "Owned-instance method observation only; no routing policy changes",
    targetNodeIds: TARGET_NODE_IDS, reportLimitBytes: MAX_REPORT_BYTES,
    ledger: [], nodes: [], aliasLists: {}, observationErrors: [],
  }

  const observe = (event: string, operation: () => void): void => {
    if (report.observationErrors.length > 0) return
    try {
      operation()
    } catch (error) {
      report.observationErrors.push({ event, message: String(error).slice(0, 1024) })
    }
  }

  const publish = (): void => {
    const bytes = Buffer.byteLength(JSON.stringify(report))
    if (bytes > MAX_REPORT_BYTES) {
      report.contextUnavailable = { reason: "Complete native context exceeded diagnostic packet limit", bytes }
      report.nodes = []
      report.aliasLists = {}
      delete report.queue.ids
      report.observationErrors.push({ event: "packet-limit", message: `${bytes} > ${MAX_REPORT_BYTES}` })
    }
    if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) {
      report.ledgerSummary = summarize(report.ledger)
      report.ledger = []
    }
    try { options.onSnapshot?.(report) }
    catch (error) {
      if (report.observationErrors.length < 4) report.observationErrors.push({ event: "snapshot", message: String(error).slice(0, 1024) })
    }
  }

  const wrap = (owner: RuntimeObject, methodName: string,
    makeWrapper: (original: (...args: any[]) => any) => (...args: any[]) => any): void => {
    const ownDescriptor = Object.getOwnPropertyDescriptor(owner, methodName)
    const original = owner[methodName]
    assert.equal(typeof original, "function", `Missing observed method ${methodName}`)
    Object.defineProperty(owner, methodName, { configurable: true, writable: true, value: makeWrapper(original) })
    restorations.push(() => {
      if (ownDescriptor) Object.defineProperty(owner, methodName, ownDescriptor)
      else delete owner[methodName]
    })
  }

  const obstacleSnapshot = (obstacle: RuntimeObject): RuntimeObject => {
    assert(highDensity)
    const members = obstacle.connectedTo
    assert(Array.isArray(members))
    const summary = summarize(members)
    if (!aliasLists.has(summary.sha256)) {
      const canonicalRoots = [...new Set(members.map((id: string) =>
        highDensity!.connMap.getNetConnectedToId(id) ??
        (Object.hasOwn(highDensity!.connMap.netMap, id) ? id : null))
        .filter((id: string | null) => id !== null))].sort()
      const aliases = { ...summary, count: members.length, members: structuredClone(members), canonicalRoots }
      aliasLists.set(summary.sha256, aliases)
      report.aliasLists[summary.sha256] = aliases
    }
    const { connectedTo: _, ...geometry } = obstacle
    return { ...structuredClone(geometry), connectedToAliasHash: summary.sha256 }
  }

  const captureNode = (node: RuntimeObject): RuntimeObject => {
    assert(highDensity)
    const nodeId = node.capacityMeshNodeId
    const existing = scopedNodes.get(nodeId)
    if (existing) return existing
    const padding = 2 * highDensity.obstacleMargin +
      1.5 * Math.max(highDensity.traceWidth, highDensity.viaDiameter)
    const window = { minX: node.center.x - node.width / 2 - padding,
      maxX: node.center.x + node.width / 2 + padding,
      minY: node.center.y - node.height / 2 - padding,
      maxY: node.center.y + node.height / 2 + padding }
    const selectRoutes = (routes: RuntimeObject[]): RuntimeObject => {
      const nearby = routes.filter((route) => routeOverlapsWindow(route, window))
      assert(nearby.length <= 256, "Native nearby route context exceeds diagnostic scope")
      return { sourceCount: routes.length, selectedCount: nearby.length, sourceSummary: summarize(routes),
        routes: nearby.map((route) => ({ ...cloneRoute(route), identity: canonicalIdentity(highDensity!.connMap, route) })) }
    }
    const nearbyObstacles = highDensity.obstacles.filter((obstacle: RuntimeObject) => {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      return obstacle.center.x + radius >= window.minX && obstacle.center.x - radius <= window.maxX &&
        obstacle.center.y + radius >= window.minY && obstacle.center.y - radius <= window.maxY
    })
    assert(nearbyObstacles.length <= 128, "Native nearby obstacle context exceeds diagnostic scope")
    const snapshot: RuntimeObject = {
      nodeId, orderIndex: nodeIndexes.get(nodeId), node: cloneNode(node), window,
      contextSelection: "Conservative world-space bounds; full route pieces and obstacle geometry retained; aliases stored once",
      settings: selectFields(highDensity.params, ["layerCount", "allowBlindAndBuriedVias", "viaDiameter",
        "viaHoleDiameter", "minViaHoleEdgeToViaHoleEdgeClearance", "traceWidth", "obstacleMargin",
        "minClearance", "viaCopperClearance", "viaToPadClearance", "effort", "captureSearchDebug",
        "includeBoardObstacles", "enableRegionalFallback", "maxB01Rips", "b01RepairOptions"]),
      boardGeometry: structuredClone(highDensity.boardGeometry),
      initialFixedRoutes: selectRoutes(highDensity.fixedHdRoutes),
      updatedFixedRoutes: selectRoutes(highDensity.getUpdatedFixedHdRoutes()),
      priorSamePhaseRoutes: selectRoutes(highDensity.routes),
      nearbyBoardObstacles: { sourceCount: highDensity.obstacles.length,
        sourceSummary: summarize(highDensity.obstacles), obstacles: nearbyObstacles.map(obstacleSnapshot) },
      attempts: [],
    }
    scopedNodes.set(nodeId, snapshot)
    report.nodes.push(snapshot)
    return snapshot
  }

  const candidateChain = (regional: RuntimeObject): RuntimeObject[] => {
    const chain: RuntimeObject[] = []
    let solver = regional.highDensitySolver
    for (let depth = 0; solver && depth < 8; depth++, solver = solver.activeSubSolver) {
      const row = { ...solverSummary(solver), ...selectFields(solver,
        ["scaleFactor", "growthAttempts", "maxGrowthAttempts", "layerCount", "viaDiameter", "bounds"] ) }
      if (Array.isArray(solver.supervisedSolvers)) {
        row.activeSupervisedIndex = solver.supervisedSolvers.findIndex((entry: RuntimeObject) => entry.solver === solver.activeSubSolver)
      }
      chain.push(row)
    }
    return chain
  }

  const inspectRegional = (): void => {
    assert(highDensity)
    const regional = highDensity.activeFallbackSolver
    if (!regional || regionalAttempts.has(regional)) return
    const node = highDensity.activeNode
    if (!node || !TARGET_NODE_IDS.includes(node.capacityMeshNodeId)) return
    const snapshot = captureNode(node)
    const attempt: RuntimeObject = { index: snapshot.attempts.length + 1,
      node: cloneNode(regional.params.nodeWithPortPoints), initial: solverSummary(regional),
      movableNames: [...regional.params.movablePreloadedConnectionNames],
      promotedNames: [...highDensity.activeFallbackPromotedFixedRouteConnectionNames],
      sections: [...highDensity.activeFallbackFixedRouteSections].map(([name, section]: [string, RuntimeObject]) => ({
        name, start: structuredClone(section.start), end: structuredClone(section.end),
        sourceRoutes: section.sourceRoutes.map(cloneRoute),
      })), fixedObstacleRoutes: highDensity.activeFallbackFixedObstacleRoutes.map(cloneRoute), rejectedCandidates: {} }
    assert(attempt.index <= 8, "Native regional attempt count exceeds diagnostic scope")
    regionalAttempts.set(regional, attempt)
    snapshot.attempts.push(attempt)
    wrap(regional, "validateCandidateWithCleanup", (original) => function (this: RuntimeObject, ...args: any[]): any {
      const previous = validation
      validation = { regional: this, call: 0 }
      try { return Reflect.apply(original, this, args) }
      finally { validation = previous }
    })
    wrap(regional, "validateCandidateRoutes", (original) => function (this: RuntimeObject, ...args: any[]): any {
      if (validation?.regional === this) validation.call++
      const result = Reflect.apply(original, this, args)
      const call = validation?.regional === this ? validation.call : null
      if (result === false && call !== null && !attempt.rejectedCandidates[call]) observe("rejected-candidate", () => {
        attempt.rejectedCandidates[call] = { call, routes: args[0].map(cloneRoute), chain: candidateChain(this) }
      })
      return result
    })
    wrap(regional, "step", (original) => function (this: RuntimeObject, ...args: any[]): any {
      const result = Reflect.apply(original, this, args)
      if ((this.solved || this.failed) && !attempt.final) observe("regional-outcome", () => {
        attempt.final = solverSummary(this)
        if (this.solved) {
          assert(Array.isArray(this.validatedRoutes), "Solved regional candidate has no validated routes")
          attempt.privateCandidateBeforeParent = this.validatedRoutes.map(cloneRoute)
        }
      })
      return result
    })
  }

  const install = (solver: RuntimeObject): void => {
    assert.equal(highDensity, undefined)
    assert.equal(solver.iterations, 0, "Observer must install before the first HD step")
    highDensity = solver
    const order = solver.unsolvedNodePortPoints.map((node: RuntimeObject) => node.capacityMeshNodeId).reverse()
    assert.equal(new Set(order).size, order.length, "Native HD queue contains duplicate node IDs")
    order.forEach((nodeId: NodeId, index: number) => nodeIndexes.set(nodeId, index))
    report.queue = { ...summarize(order), count: order.length,
      targets: TARGET_NODE_IDS.map((nodeId) => ({ nodeId, index: nodeIndexes.get(nodeId) ?? null })) }
    if (report.queue.bytes <= 200000) report.queue.ids = order
    report.highDensityInitial = solverSummary(solver)
    wrap(solver, "finishActiveNode", (original) => function (this: RuntimeObject, ...args: any[]): any {
      const node = this.activeNode
      const beforeSolved = this.stats.solvedNodeCount
      const beforeRoutes = this.routes.length
      let acceptedCopper: RuntimeObject | undefined
      if (node && TARGET_NODE_IDS.includes(node.capacityMeshNodeId)) observe("accepted-copper-before-clear", () => {
        const snapshot = captureNode(node)
        const replacements = [...this.fixedRouteReplacements].filter(([, route]: [string, RuntimeObject]) =>
          routeOverlapsWindow(route, snapshot.window))
        acceptedCopper = {
          routesPassedToFinish: args[0].map(cloneRoute),
          updatedFixedRoutes: this.getUpdatedFixedHdRoutes()
            .filter((route: RuntimeObject) => routeOverlapsWindow(route, snapshot.window))
            .map((route: RuntimeObject) => ({ ...cloneRoute(route), identity: canonicalIdentity(this.connMap, route) })),
          replacementEntries: replacements.map(([name, route]: [string, RuntimeObject]) => ({ name, route: cloneRoute(route),
            mutationMask: structuredClone(this.preloadedTraceMutationMasks.get(name)) })),
          sectionsBeforeClear: [...this.activeFallbackFixedRouteSections].map(([name, section]: [string, RuntimeObject]) => ({
            name, start: structuredClone(section.start), end: structuredClone(section.end), sourceRoutes: section.sourceRoutes.map(cloneRoute),
          })),
        }
      })
      const result = Reflect.apply(original, this, args)
      observe("accepted-node", () => {
        assert(node, "finishActiveNode called without an active node")
        assert.equal(this.stats.solvedNodeCount, beforeSolved + 1)
        assert.equal(this.activeNode, null)
        report.ledger.push([nodeIndexes.get(node.capacityMeshNodeId), "accepted", this.iterations, this.routes.length - beforeRoutes])
        if (TARGET_NODE_IDS.includes(node.capacityMeshNodeId)) {
          const snapshot = captureNode(node)
          snapshot.accepted = { iterations: this.iterations, solvedNodeCount: this.stats.solvedNodeCount,
            appendedRoutes: this.routes.slice(routeStarts.get(node.capacityMeshNodeId) ?? beforeRoutes).map(cloneRoute),
            copperBeforeParentStateClear: acceptedCopper, parentStateCleared: true }
          publish()
        }
      })
      return result
    })
    wrap(solver, "step", (original) => function (this: RuntimeObject, ...args: any[]): any {
      const beforeNode = this.activeNode
      const nextNode = beforeNode ?? this.unsolvedNodePortPoints.at(-1)
      observe("before-hd-step", () => {
        if (!beforeNode && nextNode) {
          routeStarts.set(nextNode.capacityMeshNodeId, this.routes.length)
          report.ledger.push([nodeIndexes.get(nextNode.capacityMeshNodeId), "started", this.iterations])
          if (TARGET_NODE_IDS.includes(nextNode.capacityMeshNodeId)) captureNode(nextNode)
        }
        inspectRegional()
      })
      let result: unknown
      try { result = Reflect.apply(original, this, args) }
      catch (error) {
        observe("hd-step-threw", () => {
          report.methodException = { nodeId: nextNode?.capacityMeshNodeId, message: String(error).slice(0, 2048) }
          if (nextNode) captureNode(nextNode)
        })
        throw error
      }
      observe("after-hd-step", () => {
        inspectRegional()
        if (this.failed && !report.failedNode) {
          assert(nextNode, "HD failure has no retained active node")
          report.failedNode = { nodeId: nextNode.capacityMeshNodeId, orderIndex: nodeIndexes.get(nextNode.capacityMeshNodeId),
            iterations: this.iterations, summary: solverSummary(this) }
          report.ledger.push([nodeIndexes.get(nextNode.capacityMeshNodeId), "failed", this.iterations])
          captureNode(nextNode)
          publish()
        }
      })
      return result
    })
    publish()
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const restore of restorations.reverse()) restore()
  }

  return {
    afterPipelineStep(pipeline: RuntimeObject): void {
      if (finished || disposed) return
      if (pipeline.highDensityRouteSolver && !highDensity) {
        observe("install", () => {
          report.targetTinyContext = captureTinyContext(pipeline)
          install(pipeline.highDensityRouteSolver)
        })
      }
    },
    finish(pipeline: RuntimeObject): RuntimeObject {
      if (finished) return report
      finished = true
      observe("finish", () => {
        report.pipelineFinal = solverSummary(pipeline)
        if (highDensity) report.highDensityFinal = solverSummary(highDensity)
        report.targetOutcomes = TARGET_NODE_IDS.map((nodeId) => ({ nodeId,
          orderIndex: nodeIndexes.get(nodeId) ?? null, captured: scopedNodes.has(nodeId),
          accepted: Boolean(scopedNodes.get(nodeId)?.accepted), failed: report.failedNode?.nodeId === nodeId }))
      })
      dispose()
      publish()
      return report
    },
    dispose,
    getReport(): RuntimeObject { return report },
  }
}
