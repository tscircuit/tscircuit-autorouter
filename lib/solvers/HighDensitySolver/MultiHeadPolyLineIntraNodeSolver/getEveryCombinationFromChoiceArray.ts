/**
 * Get every combination from a choice array
 *
 * getEveryCombinationFromChoiceArray([[1, 2], [3, 4], [5, 6]])
 *
 * Returns:
 * [
 *  [1, 3, 5],
 *  [1, 3, 6],
 *  [1, 4, 5],
 *  [1, 4, 6],
 *  [2, 3, 5],
 *  [2, 3, 6],
 *  [2, 4, 5],
 *  [2, 4, 6],
 * ]
 */
export const getEveryCombinationFromChoiceArray = <T>(
  choiceArray: T[][],
): T[][] => {
  if (!choiceArray || choiceArray.length === 0) {
    return [[]] // Return an array with one empty combination if input is empty
  }

  let results: T[][] = [[]]

  for (const choiceSet of choiceArray) {
    const newResults: T[][] = []
    for (const combination of results) {
      for (const choice of choiceSet) {
        newResults.push([...combination, choice])
      }
    }
    results = newResults
  }

  return results
}
