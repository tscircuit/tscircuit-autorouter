import type { SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildConnectivityMap } from "../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../bindings/initializeAutorouterBindings"

type NativeConnectivityMap = {
  strings: (string | number[])[]
  stringOffset: number
  arrays: number[][]
  netMap: [number, number][]
  idToNetMap: [number, number][]
  failedGroup: number[] | null
}

export const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson): ConnectivityMap => {
  initializeAutorouterBindings()
  const strings: string[] = []
  const ids = new Map<string, number>()
  const intern = (value: string): number => {
    const existing = ids.get(value)
    if (existing !== undefined) return existing
    const id = strings.length
    strings.push(value)
    ids.set(value, id)
    return id
  }
  const optional = (value: string | undefined): number | null => value ? intern(value) : null
  const number = (value: number): number | string => Number.isFinite(value) ? value : String(value)
  const connections = srj.connections.map(connection => ({
    name: intern(connection.name), roots: (connection.__rootConnectionNames ?? []).map(intern),
    net: optional(connection.__netConnectionName),
    points: connection.pointsToConnect.map(point => ({
      x: number(point.x), y: number(point.y),
      layers: "layers" in point ? point.layers.map(intern) : null,
      layer: "layers" in point ? null : intern(point.layer),
      port: "pcb_port_id" in point ? optional(point.pcb_port_id as string) : null,
      pointId: optional(point.pointId),
    })),
  }))
  const obstacles = srj.obstacles.map(obstacle => ({
    id: optional(obstacle.obstacleId), connected: obstacle.connectedTo.filter(Boolean).map(intern),
    offBoard: (obstacle.offBoardConnectsTo ?? []).filter(Boolean).map(intern),
    x: number(obstacle.center.x), y: number(obstacle.center.y), layers: obstacle.layers.map(intern),
  }))
  const traces = (srj.traces ?? []).map(trace => ({ids: [trace.pcb_trace_id, trace.connection_name, ...(trace.connectsTo ?? [])].filter(Boolean).map(intern)}))
  const prototypeValues: [number, number | null][] = []
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    const value: unknown = Reflect.get({}, key)
    if (value) prototypeValues.push([intern(key), typeof value === "string" ? intern(value) : null])
  }
  const encodedStrings = strings.map(value => /[\uD800-\uDFFF]/u.test(value)
    ? Array.from({length: value.length}, (_, index) => value.charCodeAt(index)) : value)
  const result = JSON.parse(buildConnectivityMap(JSON.stringify({strings: encodedStrings, prototypeValues,
    layerCount: number(srj.layerCount), connections, obstacles, traces}))) as NativeConnectivityMap
  if (result.stringOffset !== strings.length) throw new Error("Native connectivity string table offset differs")
  for (const encoded of result.strings) {
    if (typeof encoded === "string") { strings.push(encoded); continue }
    let value = ""
    for (let offset = 0; offset < encoded.length; offset += 8192) value += String.fromCharCode(...encoded.slice(offset, offset + 8192))
    strings.push(value)
  }
  const map = new ConnectivityMap({})
  const arrays = result.arrays.map(array => array.map(id => strings[id]!))
  for (const [name, array] of result.netMap) map.netMap[strings[name]!] = arrays[array]!
  for (const [id, net] of result.idToNetMap) map.idToNetMap[strings[id]!] = strings[net]!
  if (result.failedGroup !== null) {
    // Reproduce the actual dependency's exception, including runtime-specific
    // TypeError text. Native detected the failing group before mutating it.
    map.addConnections([result.failedGroup.map(id => strings[id]!)])
    throw new Error("Native connectivity construction expected addConnections to throw")
  }
  return map
}
