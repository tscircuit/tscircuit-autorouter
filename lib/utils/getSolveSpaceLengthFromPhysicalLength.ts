type SolveSpaceLengthInput = {
  physicalLength: number
  solveToPhysicalScale: number
}

export const getSolveSpaceLengthFromPhysicalLength = ({
  physicalLength,
  solveToPhysicalScale,
}: SolveSpaceLengthInput): number => {
  if (!Number.isFinite(physicalLength) || physicalLength < 0) {
    throw new Error("Physical clearance length must be finite and nonnegative")
  }
  if (!Number.isFinite(solveToPhysicalScale) || solveToPhysicalScale <= 0) {
    throw new Error("Solve-to-physical scale must be finite and positive")
  }
  const solveSpaceLength = physicalLength / solveToPhysicalScale
  if (!Number.isFinite(solveSpaceLength)) {
    throw new Error("Converted solve-space clearance length must be finite")
  }
  if (physicalLength > 0 && solveSpaceLength === 0) {
    throw new Error("Positive physical clearance length underflows solve space")
  }
  return solveSpaceLength
}
