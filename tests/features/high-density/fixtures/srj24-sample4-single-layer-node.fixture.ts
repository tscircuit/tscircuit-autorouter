import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type EndpointInput = Pick<
  PortPoint,
  | "portPointId"
  | "x"
  | "y"
  | "connectionName"
  | "rootConnectionName"
> & {
  duplicatedFromPortId?: string
}

const pairInputs: Array<readonly [EndpointInput, EndpointInput]> = [
  [
    {
      portPointId: "ce50423_pp0_z0::0",
      x: 23.89,
      y: 9.524999999999999,
      connectionName: "source_trace_175__source_net_175_mst1",
      rootConnectionName: "source_trace_175",
    },
    {
      portPointId: "ce50428_pp3_z0::0",
      x: 25.229999999999997,
      y: 9.037499999999998,
      connectionName: "source_trace_175__source_net_175_mst1",
      rootConnectionName: "source_trace_175",
    },
  ],
  [
    {
      portPointId: "ce50427_pp3_z0::0::dup2",
      duplicatedFromPortId: "ce50427_pp3_z0::0",
      x: 25.229999999999997,
      y: 7.7958333333333325,
      connectionName: "source_trace_178__source_net_178",
      rootConnectionName: "source_trace_178",
    },
    {
      portPointId: "ce46611_pp6_z0::0::dup6",
      duplicatedFromPortId: "ce46611_pp6_z0::0",
      x: 23.589999999999996,
      y: 9.380357142857141,
      connectionName: "source_trace_178__source_net_178",
      rootConnectionName: "source_trace_178",
    },
  ],
  [
    {
      portPointId: "ce50427_pp3_z0::0::dup1",
      duplicatedFromPortId: "ce50427_pp3_z0::0",
      x: 25.229999999999997,
      y: 7.779166666666666,
      connectionName: "source_trace_177__source_net_177",
      rootConnectionName: "source_trace_177",
    },
    {
      portPointId: "ce46611_pp6_z0::0::dup5",
      duplicatedFromPortId: "ce46611_pp6_z0::0",
      x: 23.589999999999996,
      y: 9.373214285714285,
      connectionName: "source_trace_177__source_net_177",
      rootConnectionName: "source_trace_177",
    },
  ],
  [
    {
      portPointId: "ce50427_pp3_z0::0",
      x: 25.229999999999997,
      y: 7.762499999999999,
      connectionName: "source_trace_176__source_net_176",
      rootConnectionName: "source_trace_176",
    },
    {
      portPointId: "ce46611_pp6_z0::0::dup4",
      duplicatedFromPortId: "ce46611_pp6_z0::0",
      x: 23.589999999999996,
      y: 9.366071428571427,
      connectionName: "source_trace_176__source_net_176",
      rootConnectionName: "source_trace_176",
    },
  ],
  [
    {
      portPointId: "ce50399_pp0_z0::0::dup2",
      duplicatedFromPortId: "ce50399_pp0_z0::0",
      x: 23.74416666666666,
      y: 6.754999999999999,
      connectionName: "source_trace_170__source_net_170",
      rootConnectionName: "source_trace_170",
    },
    {
      portPointId: "ce46611_pp6_z0::0::dup3",
      duplicatedFromPortId: "ce46611_pp6_z0::0",
      x: 23.589999999999996,
      y: 9.35892857142857,
      connectionName: "source_trace_170__source_net_170",
      rootConnectionName: "source_trace_170",
    },
  ],
]

const portPointsInPairs: Array<[PortPoint, PortPoint]> = pairInputs.map(
  ([start, end]) => [
    { ...start, z: 0, nextPortPointId: end.portPointId },
    { ...end, z: 0, prevPortPointId: start.portPointId },
  ],
)

export const srj24Sample4SingleLayerNode: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_331",
  center: { x: 24.409999999999997, y: 8.139999999999999 },
  width: 1.6400000000000006,
  height: 2.7699999999999996,
  availableZ: [0],
  portPoints: portPointsInPairs.flat(),
  portPointsInPairs,
}
