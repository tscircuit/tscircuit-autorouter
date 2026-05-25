import { expect, test, describe } from "bun:test"
import { getIntraNodeCrossings } from "../../lib/utils/getIntraNodeCrossings"

describe("getIntraNodeCrossings", () => {
  test("detects crossing with floating point coordinates", () => {
    const nodeWithPortPoints = {
      capacityMeshNodeId: "cmn_10",
      center: {
        x: -26.29498410000002,
        y: 16.500028749999984,
      },
      width: 6.190031799999957,
      height: 6.999942500000035,
      portPoints: [
        {
          x: -29.389999999999997,
          y: 13.724999999999996,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -23.19996820000004,
          y: 16.86391444444443,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -29.389999999999997,
          y: 13.250028749999984,
          z: 0,
          connectionName: "source_net_2",
          rootConnectionName: "source_net_2",
        },
        {
          x: -29.39,
          y: 19.128333333333334,
          z: 0,
          connectionName: "source_net_2",
          rootConnectionName: "source_net_2",
        },
      ],
      availableZ: [0],
    }

    // source_net_3: segment from (-29.39, 13.72) to (-23.2, 16.86)
    // source_net_2: vertical segment from (-29.39, 13.25) to (-29.39, 19.13)
    // These segments should cross because source_net_3 starts on source_net_2
    const result = getIntraNodeCrossings(nodeWithPortPoints)

    expect(result.numSameLayerCrossings).toBe(1)
  })

  test("detects overlapping horizontal segments with floating point drift", () => {
    const nodeWithPortPoints = {
      capacityMeshNodeId: "cmn_6",
      center: {
        x: -2.7499999999999956,
        y: 11.129999999999999,
      },
      width: 6.260000000000003,
      height: 3.9399999999999995,
      portPoints: [
        {
          x: -5.879999999999997,
          y: 11.030000000000001,
          z: 0,
          connectionName: "source_net_1_mst4",
          rootConnectionName: "source_net_1",
        },
        {
          x: 0.3750000000000031,
          y: 13.099999999999998,
          z: 0,
          connectionName: "source_net_1_mst4",
          rootConnectionName: "source_net_1",
        },
        {
          x: -5.294999999999999,
          y: 13.1,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -1.27,
          y: 13.099999999999998,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -5.654999999999998,
          y: 13.1,
          z: 0,
          connectionName: "source_net_1_mst2",
          rootConnectionName: "source_net_1",
        },
        {
          x: -2.54,
          y: 13.099999999999998,
          z: 0,
          connectionName: "source_net_1_mst2",
          rootConnectionName: "source_net_1",
        },
      ],
      availableZ: [0],
    }

    const result = getIntraNodeCrossings(nodeWithPortPoints)

    expect(result.numSameLayerCrossings).toBe(1)
  })
})
