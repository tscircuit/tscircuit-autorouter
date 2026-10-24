import type { MeshBarrier, MeshCorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"

export function createMeshInput(): MeshCorridorPathInput {
  const bounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 }
  const start = { x: -2.5, y: -0.3, z: 0 }, end = { x: 2.5, y: 0.3, z: 0 }
  return { srj: { bounds, layerCount: 1, minTraceWidth: 0.1, connections: [], obstacles: [] },
    routes: [{ connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] }],
    routeIndex: 0, start, end, bounds, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1,
    allowLayerChanges: false, maxNodes: 100000, heuristicWeight: 1 }
}

export function meshBox(x: number, y: number, width: number, height: number, z = 0): MeshBarrier {
  const a = { x, y, z }
  return { minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2, maxY: y + height / 2,
    minZ: z, maxZ: z, a, b: a, radius: 0, rect: { width, height, rotation: 0 } }
}
