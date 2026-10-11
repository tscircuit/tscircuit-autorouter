// Exact MinHeap derivative of @tscircuit/high-density-a01 at
// 44005d6b9dde7d93a3d3a4815b4e7c8c52b59d34. MIT; see
// ../high-density-a01-fork/LICENSE. Numeric columns remain native f64.
typedef unsigned int u32;

static void write_row(double *f, double *seq, double *id, u32 *flags,
  u32 *rows, u32 *meta, u32 index, double value_f, double value_seq,
  double value_id) {
  f[index] = value_f;
  seq[index] = value_seq;
  id[index] = value_id;
  if (flags[index] != meta[1]) {
    flags[index] = meta[1];
    rows[meta[0]++] = index;
  }
}

void push(double *f, double *seq, double *id, u32 *flags, u32 *rows,
  u32 *meta, u32 n, double value_f, double value_seq, double value_id) {
  u32 i = n;
  while (i > 0) {
    u32 p = (i - 1) >> 1;
    double parent_f = f[p], parent_seq = seq[p];
    if (parent_f != value_f ? parent_f < value_f : parent_seq < value_seq) break;
    write_row(f, seq, id, flags, rows, meta, i, parent_f, parent_seq, id[p]);
    i = p;
  }
  write_row(f, seq, id, flags, rows, meta, i, value_f, value_seq, value_id);
}

double pop(double *f, double *seq, double *id, u32 *flags, u32 *rows,
  u32 *meta, u32 n) {
  double out = id[0];
  --n;
  if (n > 0) {
    double value_f = f[n], value_seq = seq[n], value_id = id[n];
    u32 i = 0;
    while (1) {
      u32 l = i * 2 + 1, r = l + 1;
      if (l >= n) break;
      u32 m = l;
      if (r < n) {
        double left_f = f[l], right_f = f[r];
        if (!(left_f != right_f ? left_f < right_f : seq[l] < seq[r])) m = r;
      }
      double child_f = f[m], child_seq = seq[m];
      if (value_f != child_f ? value_f < child_f : value_seq < child_seq) break;
      write_row(f, seq, id, flags, rows, meta, i, child_f, child_seq, id[m]);
      i = m;
    }
    write_row(f, seq, id, flags, rows, meta, i, value_f, value_seq, value_id);
  }
  return out;
}
