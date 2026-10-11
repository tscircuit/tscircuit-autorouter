// Frozen A01 heap before hole sifting; source class SHA-256:
// 77aa4d7473141540adb28d4578d77a53a75014bc26a288b8c3e52a34aff8d27c
export class FrozenA01MinHeap {
  private f: number[] = []
  private seq: number[] = []
  private id: number[] = []
  private n = 0

  push(f: number, seq: number, id: number) {
    let i = this.n++
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!
      this.seq[0] = this.seq[this.n]!
      this.id[0] = this.id[this.n]!
      this.siftDown(0)
    }
    return out
  }

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private siftDown(i: number) {
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) return
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      if (this.less(i, m)) return
      this.swap(i, m)
      i = m
    }
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }

  private swap(i: number, j: number) {
    const tmpF = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tmpF
    const tmpS = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = tmpS
    const tmpI = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = tmpI
  }
}
