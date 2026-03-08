export const safeDivide = (numerator: number, denominator: number) => {
  if (denominator === 0) return 0
  return numerator / denominator
}
