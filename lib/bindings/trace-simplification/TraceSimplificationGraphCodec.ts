import type { TraceGraphPacket, TraceConnectivityUpdate } from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SegmentTree } from "../../data-structures/SegmentTree"
import { encodeTraceSimplificationIndex, decodeTraceSimplificationIndex } from "lib/bindings/trace-simplification/TraceSimplificationIndexCodec"
type JsonRecord = Record<string, any>
type Graph = TraceGraphPacket
type SourceWatch = { object: JsonRecord; isPoint: boolean; routingRequired: boolean; deferred: boolean; values: unknown[]; owners: Set<JsonRecord>; fields: Set<string> }
let nextIdentity = 2 ** 40

/** Preserves object identities while transporting typed routing geometry. */
export class TraceSimplificationGraphCodec {
  private readonly ids = new WeakMap<object, number>()
  readonly objects = new Map<number, any>()
  private readonly points = new Map<number, JsonRecord>()
  private readonly sourcePointObjects = new WeakSet<object>()
  private readonly pointMetadata = new WeakMap<object, { id: number; snapshot: JsonRecord }>()
  private readonly routes = new Map<number, JsonRecord>()
  private readonly obstacles = new Map<number, JsonRecord>()
  private readonly decodedObjects = new WeakSet<object>()
  private readonly decodedMaps = new WeakSet<object>()
  private readonly colorMaps = new WeakSet<object>()
  private readonly typedMaps = new WeakMap<object, "terminal" | "net" | "layers">()
  private readonly jumperArrays = new WeakSet<object>()
  private readonly jumpers = new Map<number, { id: number; value: any[] }>()
  private readonly sourceWatches = new Map<object, SourceWatch>()
  private readonly connectivityBaselines = new WeakMap<object, { map: object; keys: string[]; values: unknown[] }>()
  private readonly connectivityOperations: Set<number>[] = []
  private sourceFields: JsonRecord = {}
  private sourceKind = ""
  private normalizedObstaclesExposed = false
  private readonly privateNormalizedObstacles = new WeakSet<object>()
  private readonly exposedObstacles = new Set<object>()
  private readonly capturedCloneGroups: number[] = []
  private readonly cloneGroups = new Map<number, Map<number, any>>()

  private shallowValues(object: JsonRecord): unknown[] {
    if (this.sourcePointObjects.has(object)) return [object.x, object.y, object.z, object.traceThickness, object.toNextSegmentType, object.insideJumperPad, object.pcb_port_id, object.viaDiameter, object.toNextSegmentCircuitJsonMetadata]
    if (Array.isArray(object)) return object.slice()
    if (object instanceof Map) return [...object].flat()
    if (object instanceof Set) return [...object]
    const values: unknown[] = []
    for (const key of Object.keys(object)) values.push(key, object[key])
    return values
  }

  private sourceUnchanged(watch: SourceWatch): boolean {
    const point = watch.object, previous = watch.values
    if (watch.isPoint) return Object.is(point.x, previous[0]) && Object.is(point.y, previous[1]) && Object.is(point.z, previous[2]) && Object.is(point.traceThickness, previous[3]) && Object.is(point.toNextSegmentType, previous[4]) && Object.is(point.insideJumperPad, previous[5]) && Object.is(point.pcb_port_id, previous[6]) && Object.is(point.viaDiameter, previous[7]) && Object.is(point.toNextSegmentCircuitJsonMetadata, previous[8])
    if (Array.isArray(point)) {
      if (point.length !== previous.length) return false
      for (let index = 0; index < point.length; index++) if (!Object.is(point[index], previous[index])) return false
      return true
    }
    let index = 0
    if (watch.object instanceof Map) {
      for (const [key, value] of watch.object) {
        if (!Object.is(key, watch.values[index++]) || !Object.is(value, watch.values[index++])) return false
      }
    } else if (watch.object instanceof Set) {
      for (const value of watch.object) if (!Object.is(value, watch.values[index++])) return false
    } else if (previous.length > 64) {
      const keys = Object.keys(point), values = Object.values(point)
      if (keys.length * 2 !== previous.length) return false
      for (let offset = 0; offset < keys.length; offset++) {
        if (keys[offset] !== previous[offset * 2] || !Object.is(values[offset], previous[offset * 2 + 1])) return false
      }
      return true
    } else {
      for (const key in watch.object) {
        if (!Object.hasOwn(watch.object, key)) continue
        if (key !== watch.values[index++] || !Object.is(watch.object[key], watch.values[index++])) return false
      }
    }
    return index === watch.values.length
  }

  trackSources(params: JsonRecord, kind: string): void {
    this.sourceFields = { ...params }
    this.sourceKind = kind
    for (const obstacle of params.__normalizedObstacles ?? []) this.privateNormalizedObstacles.add(obstacle)
    const referenceFields = new Set(["inputRoute", "unsimplifiedRoute", "unsimplifiedHdRoutes", "inputHdRoutes", "otherHdRoutes", "connMap", "colorMap", "outline", "terminalLayerIndicesByPcbPortId", "netByConnectionName", "obstacleSHI", "hdRouteSHI"])
    if (["path-base", "path", "vertex"].includes(kind)) referenceFields.add("obstacles")
    const walk = (value: any, owner: JsonRecord | undefined, field: string | undefined, seen: Set<object>, routingRequired = true, deferred = false): void => {
      if (!value || typeof value !== "object" || seen.has(value)) return
      seen.add(value)
      routingRequired = routingRequired && field !== "colorMap" && !(value.netMap && value.idToNetMap)
      const geometry = (Array.isArray(value.route) && typeof value.connectionName === "string") || (this.sourcePointObjects.has(value)) || (value.center && Array.isArray(value.connectedTo))
      if (this.jumperArrays.has(value) || this.typedMaps.has(value) || this.colorMaps.has(value)) owner = value
      if (geometry && !["outline", "colorMap", "connMap", "terminalLayerIndicesByPcbPortId", "netByConnectionName"].includes(field ?? "")) owner = value
      const privateNormalized = !this.normalizedObstaclesExposed && this.privateNormalizedObstacles.has(value)
      if (!privateNormalized) {
        let watch = this.sourceWatches.get(value)
        if (!watch) { watch = { object: value, isPoint: this.sourcePointObjects.has(value), routingRequired, deferred, values: this.shallowValues(value), owners: new Set(), fields: new Set() }; this.sourceWatches.set(value, watch) }
        watch.routingRequired ||= routingRequired
        watch.deferred ||= deferred
        if (owner) watch.owners.add(owner)
        if (field && field !== "colorMap" && field !== "terminalLayerIndicesByPcbPortId" && field !== "netByConnectionName" && (!owner || ["connMap", "outline", "colorMap", "terminalLayerIndicesByPcbPortId", "netByConnectionName", "obstacleSHI", "hdRouteSHI"].includes(field))) watch.fields.add(field)
      }
      if (this.sourcePointObjects.has(value)) return
      if (value instanceof Map || value instanceof Set || Array.isArray(value)) {
        for (const entry of value.values()) walk(entry, owner, field, seen, routingRequired, deferred)
      } else {
        for (const [name, entry] of Object.entries(value)) {
          if (privateNormalized && name === "__zLayers") continue
          if (name === "circuitJsonMetadata" && value.center && Array.isArray(value.connectedTo)) continue
          const deferEntry = deferred || (name === "connectedTo" && value.center !== undefined)
          walk(entry, owner, field, seen, routingRequired && !deferEntry, deferEntry)
        }
      }
    }
    for (const [key, value] of Object.entries(params)) {
      if (key === "obstacles" && Object.hasOwn(params, "__normalizedObstacles")) continue
      if (kind === "trace" && key === "hdRoutes") {
        for (const route of value as JsonRecord[]) {
          for (const via of route.vias) walk(via, undefined, undefined, new Set())
          walk(route.jumpers, route, undefined, new Set())
        }
        continue
      }
      const deferred = key === "terminalLayerIndicesByPcbPortId" || key === "netByConnectionName"
      walk(value, undefined, referenceFields.has(key) ? key : undefined, new Set(), !deferred, deferred)
    }
  }

  exposeNormalizedObstacles(): void {
    if (this.normalizedObstaclesExposed) return
    this.normalizedObstaclesExposed = true
    // Every facade in a retained child tree uses this graph. Once any public
    // access exposes its native objects, their own properties are mutable too.
    this.trackSources(this.sourceFields, this.sourceKind)
  }

  trackArguments(args: unknown[]): void {
    this.trackSources({ ...this.sourceFields, __callArgs: args }, this.sourceKind)
  }

  sourceChanges(routingOnly: boolean | "read" = false): Graph | undefined {
    const owners = new Set<JsonRecord>(), fields: JsonRecord = {}
    for (const watch of this.sourceWatches.values()) {
      if (routingOnly === true && !watch.routingRequired) continue
      if (routingOnly === "read" && !watch.deferred) continue
      if (this.sourceUnchanged(watch)) continue
      watch.values = this.shallowValues(watch.object)
      for (const owner of watch.owners) owners.add(owner)
      for (const field of watch.fields) {
        if (field === "connMap") fields.__connectivityUpdates = [this.sourceFields.connMap]
        else fields[field] = this.sourceFields[field]
      }
    }
    if (owners.size === 0 && Object.keys(fields).length === 0) return undefined
    this.points.clear(); this.routes.clear(); this.obstacles.clear(); this.jumpers.clear()
    for (const owner of owners) {
      if (this.typedMaps.has(owner) || this.colorMaps.has(owner)) (fields.__inputUpdates ??= []).push(owner)
      else this.encode(owner)
    }
    const encoded = this.encode(fields)
    const packet = { fields: encoded, points: [...this.points.values()], routes: [...this.routes.values()], obstacles: [...this.obstacles.values()], jumpers: [...this.jumpers.values()] }
    this.points.clear(); this.routes.clear(); this.obstacles.clear(); this.jumpers.clear()
    this.trackSources(this.sourceFields, this.sourceKind)
    return packet
  }

  beginConnectivityOperation(): void { this.connectivityOperations.push(new Set()) }

  endConnectivityOperation(): void {
    this.connectivityOperations.pop()
    this.invalidateConnectivityReads()
  }

  invalidateConnectivityReads(): void {
    for (const operation of this.connectivityOperations) operation.clear()
  }

  connectivityForRead(identity: number): TraceConnectivityUpdate | undefined {
    const operation = this.connectivityOperations.at(-1)
    let graph: Graph | undefined
    if (!operation?.has(-1)) {
      graph = this.sourceChanges("read")
      operation?.add(-1)
    }
    let updated: TraceConnectivityUpdate["connectivity"]
    if (!operation?.has(identity)) {
      const connectivity = this.objects.get(identity)
      if (connectivity) {
        const map = connectivity.idToNetMap
        const keys = Object.keys(map), values = Object.values(map)
        const previous = this.connectivityBaselines.get(connectivity)
        const unchanged = previous !== undefined && previous.map === map && keys.length === previous.keys.length && keys.every((key, index) => key === previous.keys[index] && Object.is(values[index], previous.values[index]))
        if (!unchanged) {
          this.connectivityBaselines.set(connectivity, { map, keys, values })
          updated = { netMap: connectivity.netMap, idToNetMap: map }
        }
      }
      operation?.add(identity)
    }
    return graph === undefined && updated === undefined ? undefined : { connectivity: updated, graph }
  }

  refreshSourceBaseline(): void {
    for (const watch of this.sourceWatches.values()) if (watch.routingRequired) watch.values = this.shallowValues(watch.object)
  }

  identity(object: object): number {
    let id = this.ids.get(object)
    if (id === undefined) { id = nextIdentity++; this.ids.set(object, id); this.objects.set(id, object) }
    return id
  }

  register(id: number, object: any): any {
    nextIdentity = Math.max(nextIdentity, id + 1)
    this.ids.set(object, id)
    this.objects.set(id, object)
    return object
  }

  private encodePoint(point: JsonRecord): unknown {
    this.sourcePointObjects.add(point)
    const id = this.identity(point)
    let metadata = this.pointMetadata.get(point)
    const keys = Object.keys(point)
    if (!metadata || keys.length !== Object.keys(metadata.snapshot).length || keys.some(key => !Object.hasOwn(metadata!.snapshot, key) || !Object.is(point[key], metadata!.snapshot[key]))) {
      const snapshot = { ...point }
      metadata = { id: this.identity(snapshot), snapshot }
      this.pointMetadata.set(point, metadata)
    }
    this.points.set(id, { id, value: point, metadataSourceId: metadata.id })
    return { $ref: ["point", id] }
  }

  private encodeRoute(route: JsonRecord): unknown {
    const id = this.identity(route)
    const value = { ...route }
    delete value.route; delete value.vias
    const jumpersArrayId = Array.isArray(route.jumpers) ? this.encodeJumpers(route.jumpers) : undefined
    this.routes.set(id, { id, value, jumpersArrayId, propertyOrder: Object.keys(route), route: this.encodePointArray(route.route), vias: this.encodePointArray(route.vias) })
    return { $ref: ["route", id] }
  }

  private encodeJumpers(jumpers: any[]): number {
    const id = this.identity(jumpers)
    this.jumperArrays.add(jumpers)
    this.jumpers.set(id, { id, value: jumpers })
    return id
  }

  private encodePointArray(points: JsonRecord[]): unknown {
    return { $array: this.identity(points), items: points.map(point => this.encodePoint(point)) }
  }

  encode(value: any, key = ""): any {
    if (value === null || value === undefined || typeof value !== "object") return value
    if (key === "colorMap" || this.colorMaps.has(value)) {
      this.colorMaps.add(value)
      return { $colorMapId: this.identity(value), $raw: value }
    }
    if (this.decodedObjects.has(value)) {
      const fields: JsonRecord = {}
      for (const [name, entry] of Object.entries(value)) fields[name] = this.encode(entry, name)
      return { $object: this.identity(value), fields }
    }
    if (this.decodedMaps.has(value)) return { $map: this.identity(value), entries: [...value].map(([name, entry]) => [name, this.encode(entry)]) }
    if (this.jumperArrays.has(value)) return { $jumpers: this.encodeJumpers(value) }
    if (key === "outline" || key === "filteredJumperPads") return value
    const index = encodeTraceSimplificationIndex(value, key, (entry, name) => this.encode(entry, name), object => this.identity(object))
    if (index !== undefined) return index
    const mapKind = this.typedMaps.get(value) ?? (key === "terminalLayerIndicesByPcbPortId" ? "terminal" : key === "netByConnectionName" ? "net" : key === "__terminalLayerSet" ? "layers" : undefined)
    if (mapKind) {
      this.typedMaps.set(value, mapKind)
      const id = this.identity(value)
      if (mapKind === "layers") return { $layerSetId: id, $raw: [...value] }
      const entries = value instanceof Map ? [...value] : Object.entries(value)
      if (mapKind === "net") return { $netNamesId: id, $raw: Object.fromEntries(entries) }
      return { $terminalLayersId: id, $raw: Object.fromEntries(entries.map(([name, layers]) => [name, this.encode(layers, "__terminalLayerSet")])) }
    }
    if (key === "filteredVias") return value.map((entry: unknown) => ({ $raw: entry }))
    if (key === "newRoute" || key === "newVias" || key === "lastValidPath") return this.encodePointArray(value)
    if (key === "inputHdRoutes" || key === "unsimplifiedHdRoutes" || key === "hdRoutes") return { $array: this.identity(value), items: value.map((route: JsonRecord) => this.encodeRoute(route)) }
    if (Array.isArray(value)) return value.map(entry => this.encode(entry))
    if (value instanceof Set) return [...value].map(entry => this.encode(entry))
    if (value instanceof Map) {
      if (key === "buckets") return [...value].map(([name, entry]) => [name, this.encode(entry)])
      return Object.fromEntries([...value].map(([name, entry]) => [name, this.encode(entry)]))
    }
    if (Array.isArray(value.route) && typeof value.connectionName === "string") return this.encodeRoute(value)
    if (typeof value.x === "number" && typeof value.y === "number") return this.encodePoint(value)
    if (value.center && typeof value.width === "number" && typeof value.height === "number" && Array.isArray(value.connectedTo)) {
      const id = this.identity(value); this.obstacles.set(id, { id, zLayersArrayId: Array.isArray(value.__zLayers) ? this.identity(value.__zLayers) : undefined, value }); return { $ref: ["obstacle", id] }
    }
    if (value.netMap && value.idToNetMap) return { $connectivityId: this.identity(value), $raw: { netMap: value.netMap, idToNetMap: value.idToNetMap } }
    const fields: JsonRecord = {}
    for (const [name, entry] of Object.entries(value)) fields[name] = this.encode(entry, name)
    return fields
  }

  graph(fields: unknown): Graph {
    this.points.clear(); this.routes.clear(); this.obstacles.clear(); this.jumpers.clear()
    const encoded = this.encode(fields)
    const packet = { fields: encoded, points: [...this.points.values()], routes: [...this.routes.values()], obstacles: [...this.obstacles.values()], jumpers: [...this.jumpers.values()] }
    this.points.clear(); this.routes.clear(); this.obstacles.clear(); this.jumpers.clear()
    return packet
  }

  private reconcile(current: any, incoming: any): any {
    if (incoming === null || typeof incoming !== "object") return incoming
    if (Array.isArray(incoming)) {
      const result = Array.isArray(current) ? current : []
      incoming.forEach((entry, index) => { result[index] = this.reconcile(result[index], entry) })
      result.length = incoming.length
      return result
    }
    const result = current && typeof current === "object" && !Array.isArray(current) ? current : {}
    for (const key of Object.keys(result)) if (!(key in incoming) && result[key] !== undefined) delete result[key]
    for (const [key, value] of Object.entries(incoming)) result[key] = this.reconcile(result[key], value)
    return result
  }

  decode(value: any, current?: any, key = ""): any {
    if (value === null || value === undefined || typeof value !== "object") return value
    if (value.$index) return decodeTraceSimplificationIndex(value, current, (entry, previous) => this.decode(entry, previous), id => this.objects.get(id), (id, object) => this.register(id, object))
    if (value.$ref) {
      const object = this.objects.get(value.$ref[1])
      if (!object) throw new Error(`Unknown trace simplification identity ${value.$ref[1]}`)
      return object
    }
    const mapKind = Object.hasOwn(value, "$terminalLayersId") ? "terminal" : Object.hasOwn(value, "$netNamesId") ? "net" : Object.hasOwn(value, "$layerSetId") ? "layers" : undefined
    if (mapKind) {
      const id = value[mapKind === "terminal" ? "$terminalLayersId" : mapKind === "net" ? "$netNamesId" : "$layerSetId"]
      const existing = this.objects.get(id)
      if (existing) return existing
      const object = mapKind === "layers" ? new Set(value.$raw) : new Map(Object.entries(value.$raw).map(([name, entry]) => [name, mapKind === "terminal" ? this.decode(entry) : entry]))
      this.typedMaps.set(object, mapKind)
      return this.register(id, object)
    }
    if (Object.hasOwn(value, "$colorMapId")) {
      const object = this.objects.get(value.$colorMapId) ?? this.register(value.$colorMapId, value.$raw)
      this.colorMaps.add(object)
      return object
    }
    if (Object.hasOwn(value, "$connectivityId")) {
      const existing = this.objects.get(value.$connectivityId)
      if (existing) return existing
      const map = this.register(value.$connectivityId, new ConnectivityMap(value.$raw.netMap))
      this.reconcile(map.idToNetMap, value.$raw.idToNetMap)
      return map
    }
    if (Object.hasOwn(value, "$raw")) {
      if (key === "connMap" && current === undefined && value.$raw?.netMap) current = new ConnectivityMap(value.$raw.netMap)
      return this.reconcile(current, value.$raw)
    }
    if (Object.hasOwn(value, "$array")) {
      const array = this.objects.get(value.$array) ?? this.register(value.$array, [])
      value.items.forEach((entry: unknown, index: number) => { array[index] = this.decode(entry, array[index]) })
      array.length = value.items.length
      return array
    }
    if (Object.hasOwn(value, "$map")) {
      const map = this.objects.get(value.$map) ?? this.register(value.$map, new Map())
      this.decodedMaps.add(map)
      const entries = value.entries.map(([name, entry]: [unknown, unknown]) => [name, this.decode(entry, map.get(name))])
      map.clear()
      for (const [name, entry] of entries) map.set(name, entry)
      return map
    }
    if (Object.hasOwn(value, "$object")) {
      const object = this.objects.get(value.$object) ?? this.register(value.$object, {})
      if (typeof object.acceptSnapshotFields === "function") { object.acceptSnapshotFields(value.fields); return object }
      this.decodedObjects.add(object)
      return this.decode(value.fields, object)
    }
    if (key === "preservedRouteEndpoints") {
      const map = current instanceof Map ? current : new Map()
      for (const [name, entry] of Object.entries(value)) map.set(name, this.decode(entry, map.get(name)))
      for (const name of map.keys()) if (!Object.hasOwn(value, name)) map.delete(name)
      return map
    }
    if (key === "terminalLayerIndicesByPcbPortId") {
      const map = current instanceof Map ? current : new Map(); map.clear()
      for (const [name, entries] of Object.entries(value)) map.set(name, new Set(entries as number[]))
      return map
    }
    if (key === "cachedValidPathSegments" || key === "jumperPadPointIndices") {
      const set = current instanceof Set ? current : new Set(); set.clear()
      for (const entry of value) set.add(this.decode(entry))
      return set
    }
    if (key === "traceThicknessByObstacleSegmentId" || key === "buckets") {
      const map = current instanceof Map ? current : new Map(); map.clear()
      for (const [name, entry] of Array.isArray(value) ? value : Object.entries(value)) map.set(name, this.decode(entry))
      return map
    }
    if (Array.isArray(value)) {
      const array = Array.isArray(current) ? current : []
      value.forEach((entry, index) => { array[index] = this.decode(entry, array[index]) }); array.length = value.length
      return array
    }
    const result = current && typeof current === "object" ? current : key === "segmentTree" ? new SegmentTree([]) : {}
    for (const [name, entry] of Object.entries(value)) result[name] = this.decode(entry, result[name], name)
    return result
  }

  takeCapturedCloneGroups(): number[] {
    return this.capturedCloneGroups.splice(0)
  }

  hydrate(graph: Graph, current?: any): any {
    const records = new Map<number, { record: JsonRecord; kind: string }>()
    for (const record of graph.points) records.set(record.id, { record, kind: "point" })
    for (const record of graph.obstacles) records.set(record.id, { record, kind: "obstacle" })
    for (const record of graph.routes) records.set(record.id, { record, kind: "route" })
    const groups = new Map((graph.cloneGroups ?? []).map(group => [group.id, group]))
    const hydrated = new Set<number>()
    const ensureReferences = (value: any): void => {
      if (!value || typeof value !== "object") return
      if (value.$index) return decodeTraceSimplificationIndex(value, current, (entry, previous) => this.decode(entry, previous), id => this.objects.get(id), (id, object) => this.register(id, object))
    if (value.$ref) { ensureRecord(value.$ref[1]); return }
      if (Array.isArray(value)) { for (const item of value) ensureReferences(item); return }
      if (Object.hasOwn(value, "$array")) for (const item of value.items) ensureReferences(item)
    }
    const ensureGroup = (id: number): Map<number, any> => {
      const existing = this.cloneGroups.get(id)
      if (existing) return existing
      const group = groups.get(id)
      if (!group) throw new Error(`Unknown trace clone group ${id}`)
      ensureReferences(group.sources)
      const sources = this.decode(group.sources)
      const clones = structuredClone(sources)
      const mapping = new Map<number, any>()
      const visited = new Set<object>()
      const associate = (source: any, clone: any): void => {
        if (!source || typeof source !== "object" || visited.has(source)) return
        visited.add(source)
        mapping.set(this.identity(source), clone)
        if (source instanceof Map) {
          const sourceEntries = [...source], cloneEntries = [...clone]
          sourceEntries.forEach(([key, value], index) => { associate(key, cloneEntries[index][0]); associate(value, cloneEntries[index][1]) })
        } else if (source instanceof Set) {
          const cloneEntries = [...clone]
          ;[...source].forEach((value, index) => associate(value, cloneEntries[index]))
        } else for (const key of Object.keys(source)) associate(source[key], clone[key])
      }
      associate(sources, clones)
      this.cloneGroups.set(id, mapping)
      this.capturedCloneGroups.push(id)
      return mapping
    }
    const ensureRecord = (id: number): void => {
      if (hydrated.has(id)) return
      const entry = records.get(id)
      if (!entry) {
        if (!this.objects.has(id)) throw new Error(`Unknown trace simplification source ${id}`)
        return
      }
      const { record, kind } = entry
      if (record.sourceId !== null && record.sourceId !== undefined) ensureRecord(record.sourceId)
      const clone = record.cloneGroupId === null || record.cloneGroupId === undefined ? undefined : ensureGroup(record.cloneGroupId).get(record.sourceId)
      const source = kind === "point" && record.metadataSourceId !== null && record.metadataSourceId !== undefined
        ? this.objects.get(record.metadataSourceId)
        : this.objects.get(record.sourceId)
      let object = this.objects.get(id)
      const retained = object !== undefined
      if (!object) {
        object = clone ?? (source ? { ...source } : {})
        if (kind === "route" && !clone) {
          const metadataSource = this.objects.get(record.metadataSourceId)
          for (const key of record.propertyOrder ?? [...Object.keys(record.value), "route", "vias"]) object[key] = metadataSource && Object.hasOwn(metadataSource, key) ? metadataSource[key] : source?.[key]
          if (record.metadataSourceId !== null && record.metadataSourceId !== undefined) {
            for (const key of ["rootConnectionName", "startPcbPortId", "endPcbPortId", "jumpers"]) if (!Object.hasOwn(object, key)) object[key] = undefined
          }
        }
        this.register(id, object)
      }
      hydrated.add(id)
      if (retained && record.sourceOnly) return
      if (kind === "route") {
        if (clone) {
          for (const key of ["route", "vias"]) {
            const arrayId = record[key]?.$array
            if (arrayId !== undefined && !this.objects.has(arrayId)) this.register(arrayId, clone[key])
          }
        }
        for (const [key, value] of Object.entries(record.value)) {
          if (key === "jumpers" && record.jumpersArrayId !== null && record.jumpersArrayId !== undefined) continue
          object[key] = this.reconcile(object[key], value)
        }
        if (record.jumpersArrayId !== null && record.jumpersArrayId !== undefined) {
          const array = this.objects.get(record.jumpersArrayId) ?? this.register(record.jumpersArrayId, Array.isArray(object.jumpers) ? object.jumpers : [])
          object.jumpers = array
        }
        ensureReferences(record.route); ensureReferences(record.vias)
        object.route = this.decode(record.route, object.route)
        object.vias = this.decode(record.vias, object.vias)
      } else if (kind === "point" && (retained || source || clone)) {
        const consumed = ["x", "y", "z", "traceThickness", "toNextSegmentType", "insideJumperPad", "pcb_port_id"]
        if (!retained && !clone) {
          for (const key of Object.keys(object)) {
            if (!(key in record.value) && object[key] !== undefined) delete object[key]
          }
          for (const [key, value] of Object.entries(record.value)) {
            if (consumed.includes(key) || object[key] === null || typeof object[key] !== "object") object[key] = value
          }
        }
        for (const key of consumed) {
          if (Object.hasOwn(record.value, key)) object[key] = record.value[key]
          else if (object[key] !== undefined) delete object[key]
        }
      } else if (kind === "obstacle" && (retained || source)) {
        for (const key of Object.keys(object)) if (!(key in record.value) && key !== "circuitJsonMetadata" && object[key] !== undefined) delete object[key]
        for (const [key, value] of Object.entries(record.value)) if (key !== "circuitJsonMetadata" && !(key === "__zLayers" && record.zLayersArrayId !== null && record.zLayersArrayId !== undefined)) object[key] = this.reconcile(object[key], value)
      } else this.reconcile(object, record.value)
      if (kind === "obstacle" && record.zLayersArrayId !== null && record.zLayersArrayId !== undefined) {
        const layers = this.objects.get(record.zLayersArrayId) ?? this.register(record.zLayersArrayId, [])
        object.__zLayers = this.reconcile(layers, record.value.__zLayers)
      }
      if (kind === "point") {
        for (const key of record.removedProperties ?? []) delete object[key]
        if (record.segmentMetadataObstacleId !== null && record.segmentMetadataObstacleId !== undefined) {
          ensureRecord(record.segmentMetadataObstacleId)
          object.toNextSegmentCircuitJsonMetadata = this.objects.get(record.segmentMetadataObstacleId).circuitJsonMetadata
        }
      }
    }
    for (const id of records.keys()) ensureRecord(id)
    for (const record of graph.jumpers ?? []) {
      const array = this.objects.get(record.id) ?? this.register(record.id, [])
      this.reconcile(array, record.value)
    }
    if (graph.captureCloneGroups) for (const id of groups.keys()) ensureGroup(id)
    const result = this.decode(graph.fields, current)
    if (this.normalizedObstaclesExposed && graph.obstacles.length > 0) {
      for (const record of graph.obstacles) this.exposedObstacles.add(this.objects.get(record.id))
      this.trackSources({ ...this.sourceFields, __exposedObstacles: [...this.exposedObstacles] }, this.sourceKind)
    }
    this.refreshSourceBaseline()
    return result
  }
}
