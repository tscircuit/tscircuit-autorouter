export const getEveryPossibleOrdering = <T>(ar: readonly T[]): T[][] => {
  if (ar.length === 0) {
    return [[]] // Base case: empty array has one permutation (empty array)
  }

  const result: T[][] = []

  for (let i = 0; i < ar.length; i++) {
    const firstElement = ar[i]
    const rest = [...ar.slice(0, i), ...ar.slice(i + 1)]
    const permutationsOfRest = getEveryPossibleOrdering(rest)

    for (const perm of permutationsOfRest) {
      result.push([firstElement, ...perm])
    }
  }

  return result
}
