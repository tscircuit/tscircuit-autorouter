import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getParallelConnectivityMap } from "../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelConnectivityMap"
import { getConnectivityMapFromSimpleRouteJson } from "../lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "../lib/types"

test("packed construction retains native ordered merges, aliased arrays, net identities and later public mutations", () => {
  let randomState = 179239
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 0x100000000
  }
  for (let trial = 0; trial < 300; trial++) {
    const srj: SimpleRouteJson = {
      bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
      minTraceWidth: 0.15, layerCount: 4, connections: [], obstacles: [],
    }
    for (let connectionIndex = 0; connectionIndex < 25; connectionIndex++) {
      srj.connections.push({ name: `connection${connectionIndex}`,
        __rootConnectionNames: random() < 0.4 ? [`connection${Math.floor(random() * 25)}`] : [],
        __netConnectionName: random() < 0.3 ? `net${Math.floor(random() * 5)}` : undefined,
        pointsToConnect: Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
          x: Math.floor(random() * 10) / 100, y: Math.floor(random() * 10) / 100,
          layers: random() < 0.3 ? ["top", "bottom"] : [random() < 0.5 ? "top" : "bottom"],
          pcb_port_id: `port${Math.floor(random() * 30)}`,
          pointId: `point${Math.floor(random() * 35)}`,
        })),
      })
    }
    for (let obstacleIndex = 0; obstacleIndex < 40; obstacleIndex++) {
      srj.obstacles.push({ type: "rect", obstacleId: `obstacle${obstacleIndex}`,
        center: { x: Math.floor(random() * 10) / 100, y: Math.floor(random() * 10) / 100 },
        width: 0.3, height: 0.5, layers: random() < 0.5 ? ["top"] : ["top", "bottom"],
        connectedTo: Array.from({ length: Math.floor(random() * 10) }, () => `port${Math.floor(random() * 30)}`),
        offBoardConnectsTo: random() < 0.2 ? [`connection${Math.floor(random() * 25)}`] : [],
      })
    }
    const native = getConnectivityMapFromSimpleRouteJson(srj)
    const packed = getParallelConnectivityMap(srj)
    expect(packed).toBeInstanceOf(ConnectivityMap)
    expect(Object.keys(packed)).toEqual(Object.keys(native))
    expect(packed.addConnections).toBe(ConnectivityMap.prototype.addConnections)
    expect(packed.netMap).toEqual(native.netMap)
    expect(packed.idToNetMap).toEqual(native.idToNetMap)
    const keys = Object.keys(native.netMap)
    expect(Object.keys(packed.netMap)).toEqual(keys)
    for (let left = 0; left < keys.length; left++) {
      for (let right = 0; right < keys.length; right++) {
        expect(packed.netMap[keys[left]!] === packed.netMap[keys[right]!])
          .toBe(native.netMap[keys[left]!] === native.netMap[keys[right]!])
      }
    }
    const additions = [["new-port", "port0"], ["new-port", "connection0"], ["isolated-port"]]
    native.addConnections(additions)
    packed.addConnections(additions)
    expect(packed.netMap).toEqual(native.netMap)
    expect(packed.idToNetMap).toEqual(native.idToNetMap)
  }
})
