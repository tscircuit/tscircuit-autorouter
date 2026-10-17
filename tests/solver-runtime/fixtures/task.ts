export function task(input: { value: number; fail?: boolean }, { shared }: { shared: { values: number[]; buffer: SharedArrayBuffer } }): number {
  // Different costs encourage completion order to differ from input order.
  let sum = 0
  for (let i = 0; i < (20 - input.value) * 10000; i++) sum += i % 7
  if (input.fail) throw new Error(`failure-${input.value}`)
  shared.values.push(input.value)
  return input.value * input.value + shared.values.length + new Int32Array(shared.buffer)[0] + sum * 0
}
