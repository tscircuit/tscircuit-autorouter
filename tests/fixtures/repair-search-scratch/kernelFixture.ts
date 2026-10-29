import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { NegotiatedClearanceSearchInput } from "lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel"

export async function loadNativeKernel(): Promise<typeof import("lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel")> {
  const entry = fileURLToPath(import.meta.resolve("@tscircuit/repair04"))
  const path = join(dirname(entry), "negotiatedClearanceSearchKernel.ts")
  const module = await import(pathToFileURL(path).href)
  return module
}

export function kernelFixture(seed: number, layers = 2): NegotiatedClearanceSearchInput {
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const bounds = { minX: -4, maxX: 4, minY: -4, maxY: 4 }
  const route = {
    connectionName: "selected", traceThickness: 0.1, viaDiameter: 0.3,
    vias: [], route: [{ x: -3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
  }
  const coppers = Array.from({ length: 40 }, (_, index) => {
    const x = random() * 4 - 2, y = random() * 4 - 2
    const a = { x, y, z: Math.floor(random() * layers) }
    const via = random() < 0.3 && layers > 1
    const b = via ? { x, y, z: layers - 1 - a.z } : {
      x: x + random() * 0.8 - 0.4, y: y + random() * 0.8 - 0.4, z: a.z,
    }
    return {
      a, b, radius: 0.05 + random() * 0.1,
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
      minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
      spanIndex: index, owner: index % 11 === 0 ? "selected" : `owner${index % 7}`,
      index, cellX: Math.floor(Math.min(a.x, b.x)), cellY: Math.floor(Math.min(a.y, b.y)),
      immutable: index % 17 === 0,
    }
  })
  return {
    pathInput: {
      srj: { bounds, layerCount: layers, minTraceWidth: 0.1, connections: [], obstacles: [] },
      routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!,
      bounds, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1,
      allowLayerChanges: true, gridSize: 0.1, maxNodes: 1024,
    }, coppers, selectedOwner: "selected", weights: coppers.map(() => random() * 8),
  }
}
