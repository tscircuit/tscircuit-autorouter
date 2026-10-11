// Native ordered routing policy from tiny-hypergraph commit
// 474f5222e799b54348da41d96a0da0694509fab8. MIT license retained by the fork.
// Copyright (c) 2026 tscircuit. See ../tiny-hypergraph-fork/LICENSE.
typedef unsigned int u32;
typedef int i32;
typedef signed char i8;

// Scalar native CSR filtering. Survivors keep source order; a legal goal ends
// this expansion before any later ordinary visitor is considered.
u32 scan(const i32 *ports, const i32 *next_regions, const i32 *hops,
  const double *port_x, const double *port_y, const i8 *section,
  const i32 *port_reserved, const i32 *assigned, const i32 *region_reserved,
  const double *penalty, const double *best, const u32 *best_generation,
  const u32 *words, i32 *positions, double *distances,
  u32 start, u32 end, i32 current_port, i32 goal, i32 net,
  double source_x, double source_y, double g, double congestion, double scale,
  u32 generation) {
  u32 count = 0;
  if (start == end) return 0;
  u32 first = start >> 5;
  u32 final = (end - 1) >> 5;
  for (u32 word = first; word <= final; ++word) {
    u32 active = words[word];
    if (word == first) active &= 0xffffffffU << (start & 31U);
    if (word == final && (end & 31U) != 0) active &= (1U << (end & 31U)) - 1U;
    while (active != 0) {
      u32 bit = __builtin_ctz(active);
      active &= active - 1;
      u32 position = word * 32 + bit;
      i32 port = ports[position];
      i32 owner = assigned[port];
      i32 reserved = port_reserved[port];
      if (port == goal) {
        if (reserved == -2 || (reserved != -1 && reserved != net)) continue;
        if (owner != -1 && owner != net) continue;
        positions[count] = position;
        distances[count] = 0;
        return count + 1;
      }
      if (port == current_port || section[port] == 0) continue;
      i32 region = next_regions[position];
      if (region == -1) continue;
      if (reserved == -2 || (reserved != -1 && reserved != net)) continue;
      if (owner != -1 && owner != net) continue;
      reserved = region_reserved[region];
      if (reserved != -1 && reserved != net) continue;
      i32 hop = hops[position];
      double previous = best_generation[hop] == generation ? best[hop] : __builtin_inf();
      if (g >= previous) continue;
      double base = (g + congestion) + (penalty ? penalty[port] : 0);
      double dx = source_x - port_x[port];
      double dy = source_y - port_y[port];
      double distance = __builtin_sqrt(dx * dx + dy * dy);
      if (base + distance * scale >= previous) continue;
      positions[count] = position;
      distances[count] = distance;
      ++count;
    }
  }
  return count;
}
