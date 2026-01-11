export function seededRandom(seed: number) {
  // Use a simple hash to initialize both state variables
  let s = seed
  for (let i = 0; i < 10; i++) {
    s = (s * 16807) % 2147483647
  }
  let state0 = s

  // Use a different hash for the second state
  s = (seed * 69069 + 1) % 2147483647
  for (let i = 0; i < 10; i++) {
    s = (s * 48271) % 2147483647
  }
  let state1 = s

  // Return the function that generates random numbers
  return () => {
    // xorshift128+ algorithm produces much better randomness than LCG
    let s1 = state0
    const s0 = state1

    state0 = s0
    s1 ^= s1 << 23
    s1 ^= s1 >>> 17
    s1 ^= s0
    s1 ^= s0 >>> 26
    state1 = s1

    // Generate a number between 0 and 1
    const result = (state0 + state1) / 4294967296
    return result - Math.floor(result)
  }
}

// We have preshuffled cases because for small arrays, there's very few possible
// orderings, and the shuffle seed often starts at 0 and increments by 1. So we
// want to ensure for simple cases we're definitely hitting all the cases.
const PRESHUFFLED_CASES = {
  1: [[0]],
  2: [
    [0, 1],
    [1, 0],
  ],
  3: [
    [0, 1, 2],
    [2, 0, 1],
    [1, 0, 2],
    [0, 2, 1],
    [1, 2, 0],
    [2, 1, 0],
  ],
  4: [
    [0, 1, 2, 3],
    [2, 0, 1, 3],
    [1, 3, 2, 0],
    [3, 0, 1, 2],
    [0, 2, 1, 3],
    [2, 1, 3, 0],
    [3, 0, 2, 1],
    [1, 2, 0, 3],
    [3, 1, 0, 2],
    [0, 3, 2, 1],
    [2, 3, 0, 1],
    [2, 3, 1, 0],
    [1, 2, 3, 0],
    [3, 1, 2, 0],
    [0, 1, 3, 2],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 0, 2, 3],
    [1, 0, 3, 2],
    [1, 3, 0, 2],
    [2, 0, 3, 1],
    [2, 1, 0, 3],
    [3, 2, 0, 1],
    [3, 2, 1, 0],
  ],
}

export function cloneAndShuffleArray<T>(arr: T[], seed: number): T[] {
  if (seed === 0) return arr
  if (arr.length === 0) return arr

  if (arr.length <= 4) {
    const preshuffledOptions =
      PRESHUFFLED_CASES[arr.length as keyof typeof PRESHUFFLED_CASES]
    const preshuffledCase = preshuffledOptions[seed % preshuffledOptions.length]

    return preshuffledCase.map((orderIndex) => arr[orderIndex])
  }

  const random = seededRandom(seed)
  // if (arr.length === 2) {
  //   console.log(random(), seed)
  //   if (random() > 0.5) return arr.slice()
  //   return [arr[1], arr[0]]
  // }
  const shuffled = arr.slice() // Copy the array
  for (let i = 0; i < shuffled.length; i++) {
    const i1 = Math.floor(random() * shuffled.length)
    const i2 = Math.floor(random() * (i + 1))
    ;[shuffled[i1], shuffled[i2]] = [shuffled[i2], shuffled[i1]]
  }
  return shuffled
}
