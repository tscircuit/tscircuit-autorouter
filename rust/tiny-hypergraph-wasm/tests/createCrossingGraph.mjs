export function createCrossingGraph() {
  const ends = ["west", "east", "north", "south"]
  return {
    regions: [
      ...ends.map((regionId, i) => ({
        regionId, pointIds: [`p${i}`], d: { width: 1, height: 1 },
      })),
      { regionId: "middle", pointIds: ["p0", "p1", "p2", "p3"], d: {
        center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      } },
    ],
    ports: [[-1, 0], [1, 0], [0, 1], [0, -1]].map(([x, y], i) => ({
      portId: `p${i}`, region1Id: "middle", region2Id: ends[i], d: { x, y, z: 0 },
    })),
    connections: [
      { connectionId: "horizontal", startRegionId: "west", endRegionId: "east" },
      { connectionId: "vertical", startRegionId: "north", endRegionId: "south" },
    ],
  }
}
