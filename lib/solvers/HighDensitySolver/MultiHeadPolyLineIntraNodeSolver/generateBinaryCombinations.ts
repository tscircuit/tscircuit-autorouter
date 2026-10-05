/**
 * Generates all possible combinations of a binary array with a specific number of 1s and a given length
 * @param {number} oneCount - The number of 1s to include in each combination
 * @param {number} length - The total length of each combination array
 * @returns {Array<Array<number>>} - All possible combinations
 */
export function generateBinaryCombinations(oneCount: number, length: number) {
  // Validate inputs
  if (oneCount > length) {
    throw new Error("oneCount cannot be greater than length")
  }

  if (oneCount < 0 || length < 0) {
    throw new Error("oneCount and length must be non-negative")
  }

  const result: number[][] = []

  // Helper function to generate combinations recursively
  function generateCombinations(
    current: number[],
    onesLeft: number,
    position: number,
  ) {
    // Base case: if we've filled the array up to the required length
    if (position === length) {
      // If we've used exactly the required number of 1s, add this combination to the result
      if (onesLeft === 0) {
        result.push([...current])
      }
      return
    }

    // Option 1: Place a 0 at the current position
    current[position] = 0
    generateCombinations(current, onesLeft, position + 1)

    // Option 2: Place a 1 at the current position (if we still have 1s to place)
    if (onesLeft > 0) {
      current[position] = 1
      generateCombinations(current, onesLeft - 1, position + 1)
    }
  }

  // Start recursive generation with an empty array
  generateCombinations(Array(length).fill(0), oneCount, 0)

  return result
}
