import { expect, test } from "bun:test"
import fixtureJson from "./fixtures/chain.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

type BoundaryFixture = {
  regions: {
    regionId: string
    pointIds: string[]
    d: {
      center: { x: number; y: number }
      width: number
      height: number
      availableZ: number[]
    }
  }[]
  ports: {
    portId: string
    region1Id: string
    region2Id: string
    d: { x: number; y: number; z: number }
  }[]
  connections: {
    connectionId: string
    startRegionId: string
    endRegionId: string
    mutuallyConnectedNetworkId: string
  }[]
}
const fixture: BoundaryFixture = fixtureJson

test("shared tiny boundary chain preserves incidence, path pairs and endpoint identities", (): void => {
  for (let orientation = 0; orientation < 8; orientation++) {
    for (const reverse of [false, true]) {
      const regions: RegionHg[] = fixture.regions.map(
        (region): RegionHg => ({
          regionId: region.regionId,
          ports: [],
          d: {
            ...structuredClone(region.d),
            capacityMeshNodeId: region.regionId,
            layer: "z0",
          },
        }),
      )
      const regionById = new Map(
        regions.map((region) => [region.regionId, region]),
      )
      const ports: RegionPortHg[] = fixture.ports.map(
        (port, index): RegionPortHg => {
          const region1 = regionById.get(port.region1Id)!
          const region2 = regionById.get(port.region2Id)!
          const swapped = (orientation & (1 << index)) !== 0
          const result: RegionPortHg = {
            portId: port.portId,
            d: {
              ...port.d,
              portId: port.portId,
              regions: [region1, region2],
              distToCentermostPortOnZ: 0,
            },
            region1: swapped ? region2 : region1,
            region2: swapped ? region1 : region2,
          }
          region1.ports.push(result)
          region2.ports.push(result)
          return result
        },
      )
      const source = regionById.get(reverse ? "target" : "source")!
      const target = regionById.get(reverse ? "source" : "target")!
      const connection = fixture.connections[0]!
      const solver = new TinyHypergraphPortPointPathingSolver({
        graph: { regions, ports },
        connections: [
          {
            connectionId: connection.connectionId,
            mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
            startRegion: source,
            endRegion: target,
            simpleRouteConnection: {
              name: connection.connectionId,
              pointsToConnect: [
                { ...source.d.center, layer: "top", pcb_port_id: "pcb-source" },
                { ...target.d.center, layer: "top", pcb_port_id: "pcb-target" },
              ],
            },
          },
        ],
        layerCount: 2,
        effort: 0.01,
        preserveTerminalPcbPortIds: true,
        flags: { FORCE_CENTER_FIRST: false, RIPPING_ENABLED: false },
        weights: {} as HgPortPointPathingSolverParams["weights"],
      })
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
      const output = solver.getOutput()
      expect(output.nodesWithPortPoints).toHaveLength(4)
      const occurrences = new Map<string, number>()
      for (const node of output.nodesWithPortPoints) {
        expect(node.portPointsInPairs).toHaveLength(1)
        const [from, to] = node.portPointsInPairs![0]!
        expect(from.nextPortPointId).toBe(to.portPointId)
        expect(to.prevPortPointId).toBe(from.portPointId)
        for (const point of [from, to]) {
          expect(point.connectionName).toBe("route")
          expect(point.rootConnectionName).toBe("shared-net")
          expect(point.z).toBe(0)
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(
            true,
          )
          occurrences.set(
            point.portPointId!,
            (occurrences.get(point.portPointId!) ?? 0) + 1,
          )
          const original = fixture.ports.find(
            (port) => port.portId === point.portPointId,
          )
          if (original) {
            expect([original.region1Id, original.region2Id]).toContain(
              node.capacityMeshNodeId,
            )
            expect({ x: point.x, y: point.y, z: point.z }).toEqual(original.d)
          } else {
            expect(point.pcb_port_id).toBe(
              node.capacityMeshNodeId === source.regionId
                ? "pcb-source"
                : "pcb-target",
            )
          }
        }
      }
      for (const port of fixture.ports)
        expect(occurrences.get(port.portId)).toBe(2)
      expect(occurrences.size).toBe(5)
    }
  }
})
