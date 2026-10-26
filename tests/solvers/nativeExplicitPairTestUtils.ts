import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const points: PortPoint[] = [
  {
    portPointId: "ce237191_pp3_z7::7",
    x: 275.3851998,
    y: 67.5727764975,
    z: 7,
    connectionName: "source_net_altium_pcb_299",
    rootConnectionName: "source_net_altium_pcb_299",
    nextPortPointId: "ce237199_pp0_z7::7",
  },
  {
    portPointId: "ce237199_pp0_z7::7",
    x: 275.3851998,
    y: 68.39433870875,
    z: 7,
    connectionName: "source_net_altium_pcb_299",
    rootConnectionName: "source_net_altium_pcb_299",
    prevPortPointId: "ce237191_pp3_z7::7",
  },
  {
    portPointId: "ce237199_pp1_z7::7",
    x: 275.3851998,
    y: 68.89371351625,
    z: 7,
    connectionName: "source_net_altium_pcb_299",
    rootConnectionName: "source_net_altium_pcb_299",
    nextPortPointId: "ce237448_pp5_z7::7",
  },
  {
    portPointId: "ce237448_pp5_z7::7",
    x: 275.96065711999995,
    y: 67.86116864,
    z: 7,
    connectionName: "source_net_altium_pcb_299",
    rootConnectionName: "source_net_altium_pcb_299",
    prevPortPointId: "ce237199_pp1_z7::7",
  },
]

export const actualNet299Node: NodeWithPortPoints = {
  capacityMeshNodeId: "topology_merge_60781__sub_2_0",
  center: { x: 275.67292846, y: 68.18906945000002 },
  width: 0.5754573199999413,
  height: 3.220266180000003,
  portPoints: points,
  portPointsInPairs: [
    [points[0], points[1]],
    [points[2], points[3]],
  ],
  availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
}
