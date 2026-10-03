import { expect, test } from "bun:test"
import { selectConnectionPointRegion } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/select-connection-point-region"
import type {
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { ConnectionPoint } from "lib/types"

function createRegion(regionId: string, x: number, z: number): RegionHg {
  return {
    regionId,
    d: {
      capacityMeshNodeId: regionId,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layer: `z${z}`,
      availableZ: [z],
    },
    ports: [],
  }
}

test("connection region selection preserves layer, boundary and graph-order preferences", (): void => {
  const wrongLayer = createRegion("wrong-layer", 0, 1)
  const firstCandidate = createRegion("first", 0, 0)
  const boundaryCandidate = createRegion("boundary", 2.0005, 0)
  const connectedCandidate = createRegion("connected", 0, 0)
  const distantCandidate = createRegion("distant", 2.002, 0)
  const port: RegionPortHg = {
    portId: "port",
    region1: boundaryCandidate,
    region2: connectedCandidate,
    d: {
      portId: "port",
      x: 1,
      y: 0,
      z: 0,
      distToCentermostPortOnZ: 0,
      regions: [boundaryCandidate, connectedCandidate],
    },
  }
  boundaryCandidate.ports.push(port)
  connectedCandidate.ports.push(port)
  distantCandidate.ports.push(port)
  const point: ConnectionPoint = { x: 1, y: 0, layers: ["top", "top"] }
  const select = (regions: RegionHg[]): RegionHg | undefined =>
    selectConnectionPointRegion({
      graph: { regions, ports: [port] },
      point,
      layerCount: 2,
    })

  expect(select([wrongLayer, firstCandidate, boundaryCandidate, connectedCandidate]))
    .toBe(boundaryCandidate)
  expect(select([firstCandidate, connectedCandidate, boundaryCandidate]))
    .toBe(connectedCandidate)
  expect(select([wrongLayer, firstCandidate, distantCandidate]))
    .toBe(firstCandidate)
  expect(select([wrongLayer, distantCandidate])).toBeUndefined()
  port.d.z = 1
  expect(select([firstCandidate, boundaryCandidate, connectedCandidate]))
    .toBe(firstCandidate)
})
