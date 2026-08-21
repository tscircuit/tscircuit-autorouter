export const getEveryPossibleOrdering = <T extends Array<any>>(ar: T): T[] => {
  if (ar.length === 0) {
    return [[] as unknown as T]; // Base case: empty array has one permutation (empty array)
  }

  const result: T[] = [];

  for (let i = 0; i < ar.length; i++) {
    const firstElement = ar[i];
    const rest = [...ar.slice(0, i), ...ar.slice(i + 1)] as T;
    const permutationsOfRest = getEveryPossibleOrdering(rest);

    for (const perm of permutationsOfRest) {
      result.push([firstElement, ...perm] as T);
    }
  }

  return result;
};
