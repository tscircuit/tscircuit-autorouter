export const hasZRangeOverlap = (
  A_z1: number,
  A_z2: number,
  B_z1: number,
  B_z2: number,
) => {
  const Amin = Math.min(A_z1, A_z2)
  const Amax = Math.max(A_z1, A_z2)
  const Bmin = Math.min(B_z1, B_z2)
  const Bmax = Math.max(B_z1, B_z2)
  return Amin <= Bmax && Amax >= Bmin
}
