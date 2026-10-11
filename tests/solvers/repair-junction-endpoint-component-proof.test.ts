import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"
import type { HighDensityRoute, SimplifiedPcbTrace } from "high-density-repair03/lib"
import {
  getRepairJunctionAnchors,
  type JunctionPreparationDiagnostics,
  type RepairJunctionAnchors,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/getRepairJunctionAnchors"

type Srj = RelaxTraceClearanceInput["srj"]
const bounds = { minX: -4, maxX: 4, minY: -4, maxY: 4 }

function route(name: string, points: HighDensityRoute["route"], root?: string): HighDensityRoute {
  return { connectionName: name, ...(root ? { rootConnectionName: root } : {}),
    traceThickness: .1, viaDiameter: .3, vias: [], route: points }
}

function srjFor(obstacles: Srj["obstacles"] = [], traces?: SimplifiedPcbTrace[]): Srj {
  return { bounds, layerCount: 4, minTraceWidth: .1, connections: [], obstacles,
    ...(traces === undefined ? {} : { traces }) }
}

function compare(
  srj: Srj,
  routes: HighDensityRoute[],
  expectedProof: boolean,
): RepairJunctionAnchors[] {
  const before = structuredClone({ srj, routes, bounds })
  const native = getRepairJunctionAnchors(srj, routes, bounds)
  const diagnostics: JunctionPreparationDiagnostics = {
    usedEndpointComponentProof: true, canonicalNetCount: -1,
  }
  const optimized = getRepairJunctionAnchors(srj, routes, bounds, {
    skipProvenSingleEndpointComponents: true, diagnostics,
  })
  deepStrictEqual(optimized, native)
  deepStrictEqual({ srj, routes, bounds }, before)
  expect(diagnostics.usedEndpointComponentProof).toBe(expectedProof)
  for (let index = 0; index < routes.length; index++) {
    expect(optimized[index]!.segmentTimes).not.toBe(native[index]!.segmentTimes)
    expect(optimized[index]!.viaPositions).not.toBe(native[index]!.viaPositions)
    if (index > 0) {
      expect(optimized[index]!.segmentTimes).not.toBe(optimized[index - 1]!.segmentTimes)
      expect(optimized[index]!.viaPositions).not.toBe(optimized[index - 1]!.viaPositions)
    }
  }
  return optimized
}

function hasLocks(anchors: RepairJunctionAnchors[]): boolean {
  return anchors.some((item): boolean => item.segmentTimes.size !== 0 || item.viaPositions.length !== 0)
}

test("endpoint-component proof keeps native anchors, physical validation, aliases and unsupported geometry", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const linked = [
    route("first", [{ x: -3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], "net"),
    route("second", [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: 3, y: 1, z: 3 }], "net"),
    route("third", [{ x: -3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], "net"),
    route("foreign", [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }]),
    route("empty", []),
  ]
  expect(hasLocks(compare(srjFor(), linked, true))).toBe(false)
  compare(srjFor([], []), linked, true)
  compare(srjFor(), [], true)
  // Generic declared aliases rather than rootConnectionName alone join these.
  const aliases = srjFor()
  aliases.connections = [{ name: "net", mergedConnectionNames: ["first", "second", "third"], pointsToConnect: [] }]
  compare(aliases, linked.map(({ rootConnectionName: _, ...item }): HighDensityRoute => item), true)

  let randomState = 0x572939
  const random = (): number => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5
    return (randomState >>> 0) / 0x100000000
  }
  // Separate canonical nets overlap geometrically, but every individual net has
  // one exact endpoint tree. Negative zero, vias and out-of-crop ends are valid.
  for (let seed = 0; seed < 100; seed++) {
    const routes: HighDensityRoute[] = []
    for (let net = 0; net < 3; net++) {
      const endpoints = [{ x: -0, y: 0, z: net }]
      for (let edge = 0; edge < 6; edge++) {
        const start = endpoints[Math.floor(random() * endpoints.length)]!
        const end = { x: random() * 12 - 6, y: random() * 12 - 6, z: Math.floor(random() * 4) }
        routes.push(route(`${seed}-${net}-${edge}`, [start,
          { x: random() * 6 - 3, y: random() * 6 - 3, z: start.z }, end], `root${net}`))
        endpoints.push(end)
      }
    }
    compare(srjFor(), routes, true)
  }

  const padRoutes = [
    route("pad-left", [{ x: -.2, y: -.2, z: 0, pcb_port_id: "left" }, { x: -3, y: 0, z: 0 }], "padnet"),
    route("pad-right", [{ x: .2, y: .2, z: 3, pcb_port_id: "right" }, { x: 3, y: 0, z: 3 }], "padnet"),
  ]
  const pad = { type: "rect" as const, center: { x: 0, y: 0 }, width: 1, height: 1,
    layers: ["top", "inner1", "inner2", "bottom"], ccwRotationDegrees: 45,
    connectedTo: ["left", "right"] }
  compare(srjFor([pad]), padRoutes, true)
  // Copper alias alone is insufficient when a terminal is on another plane or
  // lies beyond the actual rotated pad; native endpoint validation stays intact.
  compare(srjFor([{ ...pad, layers: ["top"] }]), padRoutes, false)
  compare(srjFor([{ ...pad, width: .1, height: .1 }]), padRoutes, false)
  const unknownLayer = srjFor([{ ...pad, layers: ["unknown"] }])
  expect((): RepairJunctionAnchors[] => getRepairJunctionAnchors(unknownLayer, padRoutes, bounds))
    .toThrow("repair04 preload has an unknown layer")
  expect((): RepairJunctionAnchors[] => getRepairJunctionAnchors(unknownLayer, padRoutes, bounds, {
    skipProvenSingleEndpointComponents: true,
  })).toThrow("repair04 preload has an unknown layer")

  const separated = [
    route("horizontal", [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], "net"),
    route("vertical", [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }], "net"),
  ]
  expect(hasLocks(compare(srjFor(), separated, false))).toBe(true)
  const viaContact = [
    route("via", [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }], "net"),
    route("wire", [{ x: -2, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }], "net"),
  ]
  expect(hasLocks(compare(srjFor(), viaContact, false))).toBe(true)
  const fixed: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "net",
    route: [{ route_type: "wire", x: 0, y: -3, width: .1, layer: "top" },
      { route_type: "wire", x: 0, y: 3, width: .1, layer: "top" }] }
  expect(hasLocks(compare(srjFor([], [fixed]), [separated[0]!], false))).toBe(true)
  compare(srjFor([], [{ ...fixed, connection_name: "foreign" }]), linked, false)
  compare(srjFor(), [route("invalid", [{ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: -1 }])], false)
  compare(srjFor(), [route("invalid", [{ x: Number.NaN, y: 0, z: 0 }])], false)
  compare(srjFor(), [route("invalid", [{ x: 0, y: 0, z: 0 }])], true)

  // An accessor in the interior must see exactly the original read sequence;
  // the proof's eligibility inspection does not call it itself.
  const getterEvents: number[][] = []
  for (const optimized of [false, true]) {
    const events: number[] = []
    const interior = { x: 0, y: 0, z: 0 }
    Object.defineProperty(interior, "x", { get: (): number => { events.push(1); return 0 }, enumerable: true })
    const routes = [route("custom", [{ x: -2, y: 0, z: 0 }, interior, { x: 2, y: 0, z: 0 }])]
    const diagnostics = { usedEndpointComponentProof: false, canonicalNetCount: 0 }
    getRepairJunctionAnchors(srjFor(), routes, bounds, optimized ? {
      skipProvenSingleEndpointComponents: true, diagnostics,
    } : undefined)
    expect(diagnostics.usedEndpointComponentProof).toBe(false)
    getterEvents.push(events)
  }
  expect(getterEvents[1]).toEqual(getterEvents[0])
  expect(getterEvents[0]!.length).toBeGreaterThan(0)

  // Proxies cannot be identified by reflective plain-data checks without
  // adding traps. The captured native inspector rejects them before reflection.
  for (const location of ["srj", "bounds", "routes", "route", "points", "point", "traces"] as const) {
    const eventLists: string[][] = []
    const outputs: RepairJunctionAnchors[][] = []
    for (const optimized of [false, true]) {
      const events: string[] = []
      const proxy = <T extends object>(target: T): T => new Proxy(target, {
        get: (value, name, receiver): unknown => {
          events.push(`${String(name)}`)
          return Reflect.get(value, name, receiver)
        },
        getPrototypeOf: (): never => { throw new Error("Unexpected prototype observer") },
        ownKeys: (): never => { throw new Error("Unexpected key observer") },
        getOwnPropertyDescriptor: (): never => { throw new Error("Unexpected descriptor observer") },
      })
      let inputSrj = srjFor()
      let inputBounds = { ...bounds }
      let inputRoutes = [route("proxy", [{ x: -2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])]
      if (location === "srj") inputSrj = proxy(inputSrj)
      if (location === "bounds") inputBounds = proxy(inputBounds)
      if (location === "routes") inputRoutes = proxy(inputRoutes)
      if (location === "route") inputRoutes[0] = proxy(inputRoutes[0]!)
      if (location === "points") inputRoutes[0]!.route = proxy(inputRoutes[0]!.route)
      if (location === "point") inputRoutes[0]!.route[1] = proxy(inputRoutes[0]!.route[1]!)
      if (location === "traces") inputSrj.traces = proxy([])
      const diagnostics = { usedEndpointComponentProof: false, canonicalNetCount: 0 }
      outputs.push(getRepairJunctionAnchors(inputSrj, inputRoutes, inputBounds, optimized ? {
        skipProvenSingleEndpointComponents: true, diagnostics,
      } : undefined))
      expect(diagnostics.usedEndpointComponentProof).toBe(false)
      eventLists.push(events)
    }
    expect(eventLists[1]).toEqual(eventLists[0])
    expect(outputs[1]).toEqual(outputs[0])
    expect(eventLists[0]!.length).toBeGreaterThan(0)
  }

  const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]()) as {
    next: (this: object) => IteratorResult<unknown>
  }
  const nativeNext = iteratorPrototype.next
  const iteratorCounts: number[] = []
  for (let mode = 0; mode < 2; mode++) {
    let count = 0
    const diagnostics = { usedEndpointComponentProof: false, canonicalNetCount: 0 }
    try {
      iteratorPrototype.next = function (this: object): IteratorResult<unknown> {
        count++
        return nativeNext.call(this)
      }
      getRepairJunctionAnchors(srjFor(), linked, bounds, mode === 1 ? {
        skipProvenSingleEndpointComponents: true, diagnostics,
      } : undefined)
    } finally { iteratorPrototype.next = nativeNext }
    expect(diagnostics.usedEndpointComponentProof).toBe(false)
    iteratorCounts.push(count)
  }
  expect(iteratorCounts[1]).toBe(iteratorCounts[0])
  expect(iteratorCounts[0]!).toBeGreaterThan(0)

  const nativeMath = Math
  const mathCounts: number[] = []
  for (let mode = 0; mode < 2; mode++) {
    let count = 0
    const diagnostics = { usedEndpointComponentProof: false, canonicalNetCount: 0 }
    try {
      globalThis.Math = new Proxy(nativeMath, {
        get: (target, property, receiver): unknown => {
          count++
          return Reflect.get(target, property, receiver)
        },
      })
      getRepairJunctionAnchors(srjFor(), linked, bounds, mode === 1 ? {
        skipProvenSingleEndpointComponents: true, diagnostics,
      } : undefined)
    } finally { globalThis.Math = nativeMath }
    expect(diagnostics.usedEndpointComponentProof).toBe(false)
    mathCounts.push(count)
  }
  expect(mathCounts[1]).toBe(mathCounts[0])
  expect(mathCounts[0]!).toBeGreaterThan(0)

  const nativeFloor = Math.floor
  const numericEvents: number[][] = []
  try {
    for (const optimized of [false, true]) {
      const events: number[] = []
      Math.floor = (value: number): number => { events.push(value); return nativeFloor(value) }
      const diagnostics = { usedEndpointComponentProof: false, canonicalNetCount: 0 }
      getRepairJunctionAnchors(srjFor(), linked, bounds, optimized ? {
        skipProvenSingleEndpointComponents: true, diagnostics,
      } : undefined)
      expect(diagnostics.usedEndpointComponentProof).toBe(false)
      numericEvents.push(events)
    }
  } finally { Math.floor = nativeFloor }
  expect(numericEvents[1]).toEqual(numericEvents[0])
  expect(numericEvents[0]!.length).toBeGreaterThan(0)
})
