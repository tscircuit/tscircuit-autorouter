export const getCapacityStateId = (regionId: string, z: number): string =>
  `${regionId}@${z}`

export const parseCapacityStateId = (
  stateId: string,
): { regionId: string; z: number } => {
  const separatorIndex = stateId.lastIndexOf("@")
  return {
    regionId: stateId.slice(0, separatorIndex),
    z: Number(stateId.slice(separatorIndex + 1)),
  }
}
