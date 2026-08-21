export function createSymmetricArray(
  length: number,
  oneCount: number,
): number[] {
  // Initialize array with all zeros
  const result: number[] = new Array(length).fill(0);

  // If oneCount is 0, return array of all zeros
  if (oneCount === 0) return result;

  // If oneCount equals length, return array of all ones
  if (oneCount === length) return result.fill(1);

  // Determine whether to place 1s or 0s (whichever is fewer)
  if (oneCount <= length / 2) {
    // Place 1s symmetrically
    const gap = Math.floor(length / oneCount);
    const start = Math.floor((length - (gap * (oneCount - 1) + 1)) / 2);

    for (let i = 0; i < oneCount; i++) {
      result[start + i * gap] = 1;
    }
  } else {
    // Place 0s symmetrically (since there are fewer 0s than 1s)
    const zeroCount = length - oneCount;
    const gap = Math.floor(length / zeroCount);
    const start = Math.floor((length - (gap * (zeroCount - 1) + 1)) / 2);

    // Fill array with 1s first
    result.fill(1);

    // Place 0s symmetrically
    for (let i = 0; i < zeroCount; i++) {
      result[start + i * gap] = 0;
    }
  }

  return result;
}
