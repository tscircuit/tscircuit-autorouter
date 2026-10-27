import { expect, test } from "bun:test"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { findSingleTransitionVia, type SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { HighDensityIntraNodeRoute } from "../../lib/types/high-density-types"

test("transition ownership preserves enumerable canonical authority without enumerating the net map", () => {
  const nominal = { x: 0, y: 0 }
  const peer: HighDensityIntraNodeRoute = { connectionName: "peerAlias", traceThickness: 0.1,
    viaDiameter: 0.3, route: [{ x: 0.35, y: 0, z: 0 }, { x: 0.35, y: 0, z: 7 }], vias: [{ x: 0.35, y: 0 }] }
  const run = (netMap: Record<string, unknown>, root: string | undefined, peerRoot: string | undefined,
    aliases: Map<string, string>, foreign: boolean) => {
    let enumerations = 0
    const actualNetMap = new Proxy(netMap, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target) } })
    const connMap = { netMap: actualNetMap, getNetConnectedToId: (id: string) => aliases.get(id) } as unknown as ConnectivityMap
    const context: SingleTransitionBoardContext = { obstacles: [], layerCount: 8,
      allowBlindAndBuriedVias: false, coordinateScale: 1, viaToPadClearance: 0,
      traceToPadClearance: 0.1, viaHoleDiameter: 0.15,
      boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } },
      connMap, routedPeerRoutes: [{ ...peer, rootConnectionName: peerRoot }] }
    const result = findSingleTransitionVia({ nominal,
      start: { x: -1, y: 0.5, z: 4, connectionName: "currentAlias", rootConnectionName: root },
      end: { x: 1, y: 0.5, z: 5, connectionName: "currentAlias", rootConnectionName: root },
      connectionName: "currentAlias", center: nominal, viaDiameter: 0.3, traceThickness: 0.1, context })
    expect(result).toBeDefined()
    if (foreign) {
      expect(result).not.toEqual(nominal)
      expect(Math.hypot(result!.x - 0.35, result!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
    } else expect(result).toEqual(nominal)
    // The physical result above also runs on the old implementation; this
    // assertion catches its repeated full canonical-key scans in the hot path.
    expect(enumerations).toBe(0)
  }
  const aliases = new Map([["currentAlias", "C1"], ["peerAlias", "C1"]])
  const enumerable = { C0: [], C1: [] }
  run(enumerable, "C0", "C1", aliases, true) // Canonical root overrides a conflicting alias.
  run(enumerable, "C1", "C1", aliases, false)

  const inherited = Object.assign(Object.create({ C0: [] }), { C1: [] })
  run(inherited, "C0", "C1", aliases, false) // Inherited keys are not canonical IDs.
  const nonenumerable = { C1: [] }
  Object.defineProperty(nonenumerable, "C0", { value: [], enumerable: false })
  run(nonenumerable, "C0", "C1", aliases, false)

  for (const name of ["__proto__", "toString"]) {
    run({ C1: [] }, name, "C1", aliases, false) // Object.prototype must not claim ownership.
    const own = Object.create(null)
    Object.defineProperty(own, name, { value: [], enumerable: true })
    own.C1 = []
    run(own, name, "C1", aliases, true)
    const hidden = Object.create(null)
    Object.defineProperty(hidden, name, { value: [], enumerable: false })
    hidden.C1 = []
    run(hidden, name, "C1", aliases, false)
  }
  // Numeric-looking canonical IDs retain their exact string namespace.
  run({ "0": [], C1: [] }, "0", "C1", aliases, true)
})
