import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

export const packingCrossingNode: NodeWithPortPoints = {
  capacityMeshNodeId: "packing-crossing", center: { x: 0, y: 0 }, width: 4, height: 4,
  availableZ: [0, 1], portPoints: [
    { connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 },
    { connectionName: "b", x: 0, y: -2, z: 0 }, { connectionName: "b", x: 0, y: 2, z: 0 },
  ],
}

export function finishPackingGenerator<T>(generator: Generator<void, T>): T {
  for (let work = 0; work < 1_000_000; work++) {
    const result = generator.next()
    if (result.done) return result.value
  }
  throw new Error("Synthetic geometry generator exceeded its finite test allowance")
}

export function packingChoice(name: string, z: number, lane: number, tokens: number[]): HighDensityRoute {
  const route: HighDensityRoute["route"] = [{ x: -4, y: lane, z }]
  const vias: HighDensityRoute["vias"] = []
  for (const x of tokens) {
    route.push({ x, y: lane, z }, { x, y: 0, z }, { x, y: 0, z: 0 }, { x, y: 0, z }, { x, y: lane, z })
    vias.push({ x, y: 0 }, { x, y: 0 })
  }
  route.push({ x: 12, y: lane, z })
  return { connectionName: name, traceThickness: 0.1, viaDiameter: 0.2, route, vias }
}
