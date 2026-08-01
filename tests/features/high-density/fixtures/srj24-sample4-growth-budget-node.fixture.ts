import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const createPair = (
  start: PortPoint,
  end: PortPoint,
): [PortPoint, PortPoint] => {
  start.nextPortPointId = end.portPointId
  end.prevPortPointId = start.portPointId
  return [start, end]
}

const portPointsInPairs: [PortPoint, PortPoint][] = [
  createPair(
    {
      portPointId: "ce54406_pp3_z5::5",
      x: 27.883000000000003,
      y: 0.3314351428571427,
      z: 5,
      connectionName: "source_trace_6__source_net_6_mst0",
      rootConnectionName: "source_trace_6",
    },
    {
      portPointId: "ce54451_pp0_z0::0",
      x: 27.883000000000003,
      y: 0.320078,
      z: 0,
      connectionName: "source_trace_6__source_net_6_mst0",
      rootConnectionName: "source_trace_6",
    },
  ),
  createPair(
    {
      portPointId: "ce54451_pp0_z0::0",
      x: 27.883000000000003,
      y: 0.320078,
      z: 0,
      connectionName: "source_trace_6__source_net_6_mst5",
      rootConnectionName: "source_trace_6",
    },
    {
      portPointId: "ce54631_pp0_z0::0",
      x: 28.635,
      y: 0.070078,
      z: 0,
      connectionName: "source_trace_6__source_net_6_mst5",
      rootConnectionName: "source_trace_6",
    },
  ),
  createPair(
    {
      portPointId: "ce54433_pp0_z0_cramped::0",
      x: 27.883000000000003,
      y: 0.570078,
      z: 0,
      connectionName: "source_trace_6__source_net_6_mst11",
      rootConnectionName: "source_trace_6",
    },
    {
      portPointId: "ce54619_pp1_z4::4",
      x: 28.447499999999998,
      y: 2.116078,
      z: 4,
      connectionName: "source_trace_6__source_net_6_mst11",
      rootConnectionName: "source_trace_6",
    },
  ),
  createPair(
    {
      portPointId: "ce54590_pp0_z0::0::dup1",
      duplicatedFromPortId: "ce54590_pp0_z0::0",
      x: 28.071,
      y: -1.053922,
      z: 0,
      connectionName: "source_trace_178__source_net_178",
      rootConnectionName: "source_trace_178",
    },
    {
      portPointId: "ce54619_pp0_z4::4",
      x: 28.070500000000003,
      y: 2.116078,
      z: 4,
      connectionName: "source_trace_178__source_net_178",
      rootConnectionName: "source_trace_178",
    },
  ),
  createPair(
    {
      portPointId: "ce54590_pp0_z0::0",
      x: 28.447000000000003,
      y: -1.053922,
      z: 0,
      connectionName: "source_trace_177__source_net_177",
      rootConnectionName: "source_trace_177",
    },
    {
      portPointId: "ce54620_pp0_z3::3",
      x: 28.070500000000003,
      y: 2.116078,
      z: 3,
      connectionName: "source_trace_177__source_net_177",
      rootConnectionName: "source_trace_177",
    },
  ),
  createPair(
    {
      portPointId: "ce54627_pp0_z0_cramped::0",
      x: 28.635,
      y: -0.6799220000000001,
      z: 0,
      connectionName: "source_trace_176__source_net_176",
      rootConnectionName: "source_trace_176",
    },
    {
      portPointId: "ce54387_pp7_z3::3",
      x: 27.883000000000003,
      y: 1.9285779999999995,
      z: 3,
      connectionName: "source_trace_176__source_net_176",
      rootConnectionName: "source_trace_176",
    },
  ),
  createPair(
    {
      portPointId: "ce54634_pp0_z0::0",
      x: 28.635,
      y: 0.570078,
      z: 0,
      connectionName: "source_trace_174__source_net_174",
      rootConnectionName: "source_trace_174",
    },
    {
      portPointId: "ce54424_pp0_z0_cramped::0::dup1",
      duplicatedFromPortId: "ce54424_pp0_z0_cramped::0",
      x: 27.86123912101299,
      y: -0.9171149229419568,
      z: 0,
      connectionName: "source_trace_174__source_net_174",
      rootConnectionName: "source_trace_174",
    },
  ),
  createPair(
    {
      portPointId: "ce54636_pp0_z0::0",
      x: 28.635,
      y: 1.070078,
      z: 0,
      connectionName: "source_trace_173__source_net_173",
      rootConnectionName: "source_trace_173",
    },
    {
      portPointId: "ce54424_pp0_z0_cramped::0",
      x: 27.883000000000003,
      y: -0.929422,
      z: 0,
      connectionName: "source_trace_173__source_net_173",
      rootConnectionName: "source_trace_173",
    },
  ),
]

/** Exact costly high-density node captured from srj24 sample 4. */
export const srj24Sample4GrowthBudgetNode: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_346__sub_1_0",
  center: { x: 28.259, y: 0.5310779999999999 },
  width: 0.7519999999999989,
  height: 3.17,
  availableZ: [0, 1, 2, 3, 4, 5],
  portPoints: portPointsInPairs.flat(),
  portPointsInPairs,
}
