export const calculateMse = (squaredErrors: number[]) => {
  // Each entry is already (predictedFailure - actualFailure) ** 2.
  return (
    squaredErrors.reduce((sum, squaredError) => {
      return sum + squaredError
    }, 0) / squaredErrors.length
  )
}
