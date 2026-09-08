type DiagnosticRecord = Record<string, unknown>

type NativeSnapshot = {
  source: string
  portCount: number
  regionCount: number
  routeCount: number
  incidentRegions: number[][]
  incidentPorts: number[][]
  regionNets: number[]
  sectionMask: number[]
  denseReservations: number[]
  physicalReservations: number[]
  endpointNets: number[][]
  starts: number[]
  ends: number[]
  nets: number[]
  attempts: number[]
  successes: number[]
  portX: number[]
  portY: number[]
  portZ: number[]
  regionX: number[]
  regionY: number[]
  regionWidth: number[]
  regionHeight: number[]
  regionLayers: number[]
  portMetadata: unknown[]
  regionMetadata: unknown[]
  routeMetadata: unknown[]
  canonicalNets: Map<number, string>
}

type FrontierReason =
  | "blocked-start-reservation"
  | "blocked-goal-reservation"
  | "foreign-port-reservation"
  | "foreign-region-reservation"
  | "outside-section"
  | "no-opposite-region"

type FrontierEdge = {
  regionId: number | null
  portId: number
  nextRegionId: number | null
  reason: FrontierReason
}

type NetEvidence = { nativeNetId: number; canonicalNetId: string | null }

type PortEvidence = {
  portId: number
  x: number
  y: number
  z: number
  sectionMask: number
  combinedReservation: NetEvidence
  physicalReservation: NetEvidence
  endpointNetIds: NetEvidence[]
  metadata: unknown
}

type RegionEvidence = {
  regionId: number
  x: number
  y: number
  width: number
  height: number
  availableZMask: number
  reservation: NetEvidence
  metadata: unknown
}

export type TinyStaticRouteCertificate = {
  routeId: number
  attempts: number
  net: NetEvidence
  metadata: unknown
  startPortId: number
  goalPortId: number
  startingRegionId: number | null
  status:
    | "connected-in-optimistic-graph"
    | "disconnected-in-optimistic-graph"
  reachedStateCount: number
  /** Complete directed closure only for a disconnected result. */
  reachedStates: [number, number][] | null
  /** Native port/region IDs only, never copper handed back to routing. */
  witness: [number, number][] | null
  /** Complete deduplicated frontier; no reporting cap. */
  frontier: FrontierEdge[]
  frontierPorts: PortEvidence[]
  frontierRegions: RegionEvidence[]
}

type InstanceCertificate =
  | {
      source: string
      status: "complete"
      portCount: number
      regionCount: number
      routeCount: number
      attemptedNeverSuccessfulCount: number
      unattemptedCount: number
      routes: TinyStaticRouteCertificate[]
    }
  | { source: string | null; status: "unsupported-input"; reason: string }

export type TinyStaticReachabilityCertificate = {
  diagnostic: "tiny-static-reachability"
  model: "optimistic-static-connectivity"
  status: "complete" | "partially-unavailable" | "unavailable"
  reason: string | null
  elapsedMs: number
  limitations: readonly string[]
  instances: InstanceCertificate[]
}

const LIMITATIONS = [
  "This is a post-failure optimistic static graph, not another routing attempt.",
  "Disconnected proves blocking in the captured native input; connected does not prove physical or simultaneous routability.",
  "Dynamic foreign occupancy, intersection costs, cost finiteness/pruning, heuristic state and search budgets are omitted.",
  "Layer masks are reported, not promoted into a new native hard edge predicate.",
  "Only attempted, never-successful routes in an explicitly observed seed-free problem are analyzed; reopened successful spans are not analyzed.",
  "Physical reservations are authoritative captured values; an unknown canonical owner is null, not an invented net.",
  "Frontier metadata contains captured serialized IDs and source fields; absent physicalCutId or source provenance is not reconstructed.",
] as const

const requireRecord = (value: unknown, name: string): DiagnosticRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an observed object`)
  }
  // The public entry point consumes JSON data, not a live native solver.
  // In particular, it never invokes a lazy setup or endpoint method.
  return value as DiagnosticRecord
}

const requireArray = (
  value: unknown,
  name: string,
  length?: number,
): unknown[] => {
  if (
    !Array.isArray(value) ||
    (length !== undefined && value.length !== length)
  ) {
    throw new Error(`${name} must be an observed array of the expected length`)
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${name}[${index}] was not observed`)
    }
  }
  return value
}

const requireInteger = (
  value: unknown,
  name: string,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an in-range integer`)
  }
  return value
}

const requireNumbers = (
  value: unknown,
  name: string,
  length: number,
  minimum: number,
  integer: boolean = true,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number[] => {
  return requireArray(value, name, length).map((item, index): number => {
    if (integer) {
      return requireInteger(item, `${name}[${index}]`, minimum, maximum)
    }
    if (typeof item !== "number" || !Number.isFinite(item) || item < minimum) {
      throw new Error(`${name}[${index}] must be a finite number`)
    }
    return item
  })
}

const requireLists = (
  value: unknown,
  name: string,
  length: number,
  maximum: number,
): number[][] => {
  return requireArray(value, name, length).map((item, index): number[] => {
    const entries = requireArray(item, `${name}[${index}]`)
    return requireNumbers(
      entries,
      `${name}[${index}]`,
      entries.length,
      0,
      true,
      maximum,
    )
  })
}

const requireSeedFree = (
  instance: DiagnosticRecord,
  problem: DiagnosticRecord,
): void => {
  const status = instance.initialAssignmentsStatus
  if (status === "captured-array") {
    const assignments = requireArray(
      problem.initialAssignments,
      "initialAssignments",
    )
    if (assignments.length === 0) return
    throw new Error(
      "Seeded native problems are outside this certificate domain",
    )
  }
  if (
    status === "absent-optional-native-field" &&
    problem.initialAssignments === null
  ) {
    return
  }
  throw new Error(
    "No-seed status was not explicitly observed; null is not an empty assignment array",
  )
}

const parseSnapshot = (value: unknown): NativeSnapshot => {
  const instance = requireRecord(value, "native instance")
  if (
    instance.nativeSolverClass !==
      "SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments" ||
    instance.failed !== true ||
    instance.setupStatus !== "already-computed-own-data" ||
    typeof instance.source !== "string"
  ) {
    throw new Error(
      "Expected the failed supported native class with an already-retained setup",
    )
  }
  const topology = requireRecord(instance.topology, "topology")
  const problem = requireRecord(instance.problem, "problem")
  const setup = requireRecord(instance.setup, "setup")
  const context = requireRecord(
    instance.fixedCopperContext,
    "fixedCopperContext",
  )
  requireSeedFree(instance, problem)
  const portCount = requireInteger(topology.portCount, "portCount", 1)
  const regionCount = requireInteger(topology.regionCount, "regionCount", 1)
  const routeCount = requireInteger(problem.routeCount, "routeCount", 0)
  if (portCount > 0x3fffffff) {
    throw new Error(
      "Directed port states cannot be represented by the diagnostic index",
    )
  }
  const canonicalNets = new Map<number, string>()
  for (const entry of requireArray(
    context.canonicalNetIdByNetId,
    "canonical net map",
  )) {
    const pair = requireArray(entry, "canonical net entry", 2)
    const net = requireInteger(pair[0], "canonical native net", 0)
    if (
      typeof pair[1] !== "string" ||
      pair[1].length === 0 ||
      canonicalNets.has(net)
    ) {
      throw new Error(
        "Canonical native net entries must have unique IDs and named owners",
      )
    }
    canonicalNets.set(net, pair[1])
  }
  const snapshot: NativeSnapshot = {
    source: instance.source,
    portCount,
    regionCount,
    routeCount,
    incidentRegions: requireLists(
      topology.incidentPortRegion,
      "incidentPortRegion",
      portCount,
      regionCount - 1,
    ),
    incidentPorts: requireLists(
      topology.regionIncidentPorts,
      "regionIncidentPorts",
      regionCount,
      portCount - 1,
    ),
    regionNets: requireNumbers(
      problem.regionNetId,
      "regionNetId",
      regionCount,
      -1,
    ),
    sectionMask: requireNumbers(
      problem.portSectionMask,
      "portSectionMask",
      portCount,
      0,
      true,
      1,
    ),
    denseReservations: requireNumbers(
      setup.portEndpointReservationNetId,
      "combined reservations",
      portCount,
      -2,
    ),
    physicalReservations: requireNumbers(
      instance.fixedCopperPortReservations,
      "physical reservations",
      portCount,
      -2,
    ),
    endpointNets: requireLists(
      setup.portEndpointNetIds,
      "endpoint net sets",
      portCount,
      Number.MAX_SAFE_INTEGER,
    ),
    starts: requireNumbers(
      problem.routeStartPort,
      "routeStartPort",
      routeCount,
      0,
      true,
      portCount - 1,
    ),
    ends: requireNumbers(
      problem.routeEndPort,
      "routeEndPort",
      routeCount,
      0,
      true,
      portCount - 1,
    ),
    nets: requireNumbers(problem.routeNet, "routeNet", routeCount, 0),
    attempts: requireNumbers(
      instance.routeAttemptCountByRouteId,
      "route attempts",
      routeCount,
      0,
    ),
    successes: requireNumbers(
      instance.routeSuccessCountByRouteId,
      "route successes",
      routeCount,
      0,
    ),
    portX: requireNumbers(topology.portX, "portX", portCount, -Infinity, false),
    portY: requireNumbers(topology.portY, "portY", portCount, -Infinity, false),
    portZ: requireNumbers(topology.portZ, "portZ", portCount, 0),
    regionX: requireNumbers(
      topology.regionCenterX,
      "regionCenterX",
      regionCount,
      -Infinity,
      false,
    ),
    regionY: requireNumbers(
      topology.regionCenterY,
      "regionCenterY",
      regionCount,
      -Infinity,
      false,
    ),
    regionWidth: requireNumbers(
      topology.regionWidth,
      "regionWidth",
      regionCount,
      Number.MIN_VALUE,
      false,
    ),
    regionHeight: requireNumbers(
      topology.regionHeight,
      "regionHeight",
      regionCount,
      Number.MIN_VALUE,
      false,
    ),
    regionLayers: requireNumbers(
      topology.regionAvailableZMask,
      "regionAvailableZMask",
      regionCount,
      -0x80000000,
    ),
    portMetadata: requireArray(
      topology.portMetadata,
      "portMetadata",
      portCount,
    ),
    regionMetadata: requireArray(
      topology.regionMetadata,
      "regionMetadata",
      regionCount,
    ),
    routeMetadata: requireArray(
      problem.routeMetadata,
      "routeMetadata",
      routeCount,
    ),
    canonicalNets,
  }
  const portsByRegion = snapshot.incidentPorts.map(
    (ports): Set<number> => new Set(ports),
  )
  for (let portId = 0; portId < portCount; portId++) {
    const regions = snapshot.incidentRegions[portId]!
    if (regions.length > 2) {
      throw new Error(
        `Port ${portId} has more than two incident regions; unsupported native topology`,
      )
    }
    for (const regionId of regions) {
      if (!portsByRegion[regionId]!.has(portId)) {
        throw new Error(
          `Port ${portId} lists region ${regionId} without its reverse incidence`,
        )
      }
    }
  }
  for (let regionId = 0; regionId < regionCount; regionId++) {
    for (const portId of snapshot.incidentPorts[regionId]!) {
      if (!snapshot.incidentRegions[portId]!.includes(regionId)) {
        throw new Error(
          `Region ${regionId} lists port ${portId} without its reverse incidence`,
        )
      }
    }
  }
  for (let routeId = 0; routeId < routeCount; routeId++) {
    const net = snapshot.nets[routeId]!
    if (!canonicalNets.has(net)) {
      throw new Error(
        `Route native net ${net} has no captured canonical mapping`,
      )
    }
    if (
      snapshot.attempts[routeId]! > 0 &&
      snapshot.successes[routeId] === 0 &&
      (snapshot.incidentRegions[snapshot.starts[routeId]!]!.length === 0 ||
        snapshot.incidentRegions[snapshot.ends[routeId]!]!.length === 0)
    ) {
      throw new Error(
        `Analyzed route ${routeId} has an isolated endpoint without a native region attachment`,
      )
    }
  }
  return snapshot
}

const describeNet = (
  snapshot: NativeSnapshot,
  nativeNetId: number,
): NetEvidence => {
  const canonicalNetId = snapshot.canonicalNets.get(nativeNetId)
  return {
    nativeNetId,
    // Sentinel and absent-owner values retain their exact numeric meaning.
    canonicalNetId: canonicalNetId === undefined ? null : canonicalNetId,
  }
}

const describePort = (
  snapshot: NativeSnapshot,
  portId: number,
): PortEvidence => {
  return {
    portId,
    x: snapshot.portX[portId]!,
    y: snapshot.portY[portId]!,
    z: snapshot.portZ[portId]!,
    sectionMask: snapshot.sectionMask[portId]!,
    combinedReservation: describeNet(
      snapshot,
      snapshot.denseReservations[portId]!,
    ),
    physicalReservation: describeNet(
      snapshot,
      snapshot.physicalReservations[portId]!,
    ),
    endpointNetIds: snapshot.endpointNets[portId]!.map(
      (net): NetEvidence => describeNet(snapshot, net),
    ),
    metadata: snapshot.portMetadata[portId],
  }
}

const describeRegion = (
  snapshot: NativeSnapshot,
  regionId: number,
): RegionEvidence => {
  return {
    regionId,
    x: snapshot.regionX[regionId]!,
    y: snapshot.regionY[regionId]!,
    width: snapshot.regionWidth[regionId]!,
    height: snapshot.regionHeight[regionId]!,
    availableZMask: snapshot.regionLayers[regionId]!,
    reservation: describeNet(snapshot, snapshot.regionNets[regionId]!),
    metadata: snapshot.regionMetadata[regionId],
  }
}

const analyzeRoute = (
  snapshot: NativeSnapshot,
  routeId: number,
): TinyStaticRouteCertificate => {
  const net = snapshot.nets[routeId]!
  const start = snapshot.starts[routeId]!
  const goal = snapshot.ends[routeId]!
  const incidentStart = snapshot.incidentRegions[start]!
  const startRegion =
    incidentStart.find(
      (region): boolean => snapshot.regionNets[region] === -1,
    ) ??
    incidentStart.find(
      (region): boolean => snapshot.regionNets[region] === net,
    ) ??
    incidentStart[0]
  const frontier = new Map<string, FrontierEdge>()
  const addFrontier = (edge: FrontierEdge): void => {
    const key = `${edge.regionId}:${edge.portId}:${edge.nextRegionId}:${edge.reason}`
    if (frontier.has(key)) return
    // All incoming reached states for this region share this static reason.
    // The complete reached-state list makes the factored cut reconstructible.
    frontier.set(key, edge)
  }
  const parents = new Int32Array(snapshot.portCount * 2).fill(-2)
  const queue: number[] = []
  let goalFromHop: number | undefined
  for (const [portId, reason] of [
    [start, "blocked-start-reservation"],
    [goal, "blocked-goal-reservation"],
  ] as const) {
    const reservation = snapshot.denseReservations[portId]!
    if (reservation !== -1 && reservation !== net) {
      addFrontier({ regionId: null, portId, nextRegionId: null, reason })
    }
  }
  if (startRegion === undefined) {
    throw new Error(`Analyzed route ${routeId} has no native starting region`)
  }
  if (frontier.size === 0) {
    const startHop = start * 2 + (incidentStart[0] === startRegion ? 0 : 1)
    parents[startHop] = -1
    queue.push(startHop)
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const hop = queue[cursor]!
    const entry = Math.floor(hop / 2)
    const region = snapshot.incidentRegions[entry]![hop % 2]!
    const regionOwner = snapshot.regionNets[region]!
    if (regionOwner !== -1 && regionOwner !== net) {
      addFrontier({
        regionId: region,
        portId: entry,
        nextRegionId: region,
        reason: "foreign-region-reservation",
      })
      continue
    }
    for (const exit of snapshot.incidentPorts[region]!) {
      const owner = snapshot.denseReservations[exit]!
      if (owner !== -1 && owner !== net) {
        addFrontier({
          regionId: region,
          portId: exit,
          nextRegionId: null,
          reason: "foreign-port-reservation",
        })
        continue
      }
      // Native goal acceptance precedes section/self/opposite-region checks.
      if (exit === goal) {
        goalFromHop = hop
        break
      }
      if (exit === entry) continue
      if (snapshot.sectionMask[exit] === 0) {
        addFrontier({
          regionId: region,
          portId: exit,
          nextRegionId: null,
          reason: "outside-section",
        })
        continue
      }
      const incident = snapshot.incidentRegions[exit]!
      const next = incident[0] === region ? incident[1] : incident[0]
      if (next === undefined) {
        // A genuine one-incident boundary port is a native dead end.
        addFrontier({
          regionId: region,
          portId: exit,
          nextRegionId: null,
          reason: "no-opposite-region",
        })
        continue
      }
      const nextOwner = snapshot.regionNets[next]!
      if (nextOwner !== -1 && nextOwner !== net) {
        addFrontier({
          regionId: region,
          portId: exit,
          nextRegionId: next,
          reason: "foreign-region-reservation",
        })
        continue
      }
      const nextHop = exit * 2 + (incident[0] === next ? 0 : 1)
      if (parents[nextHop] !== -2) continue
      parents[nextHop] = hop
      queue.push(nextHop)
    }
    if (goalFromHop !== undefined) break
  }
  const connected = goalFromHop !== undefined
  const witness: [number, number][] | null = connected ? [] : null
  if (witness && goalFromHop !== undefined) {
    let hop = goalFromHop
    const finalEntry = Math.floor(hop / 2)
    witness.push([goal, snapshot.incidentRegions[finalEntry]![hop % 2]!])
    while (hop !== -1) {
      const port = Math.floor(hop / 2)
      witness.push([port, snapshot.incidentRegions[port]![hop % 2]!])
      hop = parents[hop]!
    }
    witness.reverse()
  }
  const edges = connected ? [] : [...frontier.values()]
  const portIds = new Set([start, goal])
  const regionIds = new Set<number>()
  if (startRegion !== undefined) regionIds.add(startRegion)
  for (const edge of edges) {
    portIds.add(edge.portId)
    if (edge.regionId !== null) regionIds.add(edge.regionId)
    if (edge.nextRegionId !== null) regionIds.add(edge.nextRegionId)
  }
  return {
    routeId,
    attempts: snapshot.attempts[routeId]!,
    net: describeNet(snapshot, net),
    metadata: snapshot.routeMetadata[routeId],
    startPortId: start,
    goalPortId: goal,
    startingRegionId: startRegion,
    status: connected
      ? "connected-in-optimistic-graph"
      : "disconnected-in-optimistic-graph",
    reachedStateCount: queue.length,
    reachedStates: connected
      ? null
      : queue.map((hop): [number, number] => {
          const port = Math.floor(hop / 2)
          return [port, snapshot.incidentRegions[port]![hop % 2]!]
        }),
    witness,
    frontier: edges,
    frontierPorts: [...portIds].map(
      (port): PortEvidence => describePort(snapshot, port),
    ),
    frontierRegions: [...regionIds].map(
      (region): RegionEvidence => describeRegion(snapshot, region),
    ),
  }
}

/** Analyze captured JSON only, after the original hosted routing failure. */
export function createTinyStaticReachabilityCertificate(
  capture: unknown,
): TinyStaticReachabilityCertificate {
  const started = performance.now()
  const instances: InstanceCertificate[] = []
  let reason: string | null = null
  try {
    const input = requireRecord(capture, "tiny failure capture")
    if (
      input.diagnostic !== "tiny-failure" ||
      input.status !== "loaded-tiny-state"
    ) {
      throw new Error(
        "No supported retained Tiny failure snapshot is available",
      )
    }
    const capturedInstances = requireArray(
      input.nativeInstances,
      "nativeInstances",
    )
    if (capturedInstances.length === 0) {
      throw new Error("No native instance was observed")
    }
    for (const value of capturedInstances) {
      let source: string | null = null
      try {
        const raw = requireRecord(value, "native instance")
        if (typeof raw.source === "string") source = raw.source
        const snapshot = parseSnapshot(raw)
        const routes: TinyStaticRouteCertificate[] = []
        let unattemptedCount = 0
        for (let routeId = 0; routeId < snapshot.routeCount; routeId++) {
          if (snapshot.attempts[routeId] === 0) {
            unattemptedCount++
            continue
          }
          if (snapshot.successes[routeId] === 0) {
            routes.push(analyzeRoute(snapshot, routeId))
          }
        }
        instances.push({
          source: snapshot.source,
          status: "complete",
          portCount: snapshot.portCount,
          regionCount: snapshot.regionCount,
          routeCount: snapshot.routeCount,
          attemptedNeverSuccessfulCount: routes.length,
          unattemptedCount,
          routes,
        })
      } catch (error) {
        instances.push({
          source,
          status: "unsupported-input",
          reason: String(error),
        })
      }
    }
  } catch (error) {
    reason = String(error)
  }
  const completeCount = instances.filter(
    (instance): boolean => instance.status === "complete",
  ).length
  return {
    diagnostic: "tiny-static-reachability",
    model: "optimistic-static-connectivity",
    status:
      completeCount === 0
        ? "unavailable"
        : completeCount === instances.length
          ? "complete"
          : "partially-unavailable",
    reason,
    elapsedMs: performance.now() - started,
    limitations: LIMITATIONS,
    instances,
  }
}
