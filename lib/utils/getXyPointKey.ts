export const getXyPointKey = (point: { x: number; y: number }) =>
  `${point.x.toFixed(4)},${point.y.toFixed(4)}`
