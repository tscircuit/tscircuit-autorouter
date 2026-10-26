import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching keeps the distinct layers and identities of sample24 C14.2 and C12.2", () => {
  const bottomX = 197.9839449
  const y = 125.94207222
  for (const topX of [197.98440972, bottomX]) {
    for (const reversed of [false, true]) {
      const terminals = [
        {
          x: bottomX,
          y,
          layer: "bottom",
          pcb_port_id: "pcb_port_altium_8623",
          z: 7,
        },
        { x: topX, y, layer: "top", pcb_port_id: "pcb_port_altium_7313", z: 0 },
      ]
      if (reversed) terminals.reverse()
      const connection: SimpleRouteConnection = {
        name: "source_net_altium_pcb_377_mst0",
        pointsToConnect: terminals,
      }
      const hdRoute: HighDensityIntraNodeRoute = {
        connectionName: connection.name,
        rootConnectionName: "source_net_altium_pcb_377",
        startPcbPortId: terminals[0].pcb_port_id,
        endPcbPortId: terminals[1].pcb_port_id,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        // The existing via has one XY position on both layers. The two real
        // terminal centers are only .00046482mm apart and cover that position.
        route: terminals.map((terminal) => ({ x: bottomX, y, z: terminal.z })),
        vias: [{ x: bottomX, y }],
      }
      const solver = new MultipleHighDensityRouteStitchSolver3({
        connections: [connection],
        hdRoutes: [hdRoute],
        layerCount: 8,
        preserveTerminalPcbPortIds: true,
        preferSameLayerTerminalEndpoints: true,
      })
      solver.solve()

      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.mergedHdRoutes).toHaveLength(1)
      const merged = solver.mergedHdRoutes[0]
      const expectedLayer = new Map(
        terminals.map((terminal) => [terminal.pcb_port_id, terminal.z]),
      )
      expect(new Set([merged.startPcbPortId, merged.endPcbPortId])).toEqual(
        new Set(expectedLayer.keys()),
      )
      const expectedStartLayer = expectedLayer.get(merged.startPcbPortId!)
      const expectedEndLayer = expectedLayer.get(merged.endPcbPortId!)
      expect(expectedStartLayer).toBeDefined()
      expect(expectedEndLayer).toBeDefined()
      expect(merged.route[0].z).toBe(expectedStartLayer!)
      expect(merged.route.at(-1)!.z).toBe(expectedEndLayer!)
      expect(
        merged.route.some(
          (point, index) => index > 0 && point.z !== merged.route[index - 1].z,
        ),
      ).toBe(true)
    }
  }
})
