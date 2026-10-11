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

typedef unsigned char u8;
void score_region_intersections(const i32 *, const i32 *, const i32 *, const i32 *, const i32 *,
  const i32 *, const i32 *, const i32 *, const i32 *, const i32 *, const i32 *,
  i32 *, i32 *, i32 *, i32 *, i32 *, i32 *, u8 *,
  u32, u32, i32, i32, i32, i32, double);

u32 scan_scored(const i32 *ports, const i32 *next_regions, const i32 *hops,
  const double *port_x, const double *port_y, const i8 *section,
  const i32 *port_reserved, const i32 *assigned, const i32 *region_reserved,
  const double *penalty, const double *best, const u32 *best_generation,
  const u32 *words, i32 *positions, double *distances,
  const i32 *first_region, const i32 *second_region, const i32 *angle1,
  const i32 *angle2, const i32 *z, const i32 *existing_net,
  const i32 *existing_lesser, const i32 *existing_greater, const i32 *existing_layers,
  i32 *same_out, i32 *cross_out, i32 *changes_out, i32 *lesser_out,
  i32 *greater_out, i32 *layers_out, u8 *flags_out,
  u32 start, u32 end, i32 current_port, i32 goal, i32 net,
  double source_x, double source_y, double g, double congestion, double scale,
  u32 generation, i32 current_region, u32 existing_length, double existing_count) {
  u32 count = scan(ports, next_regions, hops, port_x, port_y, section,
    port_reserved, assigned, region_reserved, penalty, best, best_generation,
    words, positions, distances, start, end, current_port, goal, net,
    source_x, source_y, g, congestion, scale, generation);
  score_region_intersections(first_region, second_region, angle1, angle2, z,
    ports, positions, existing_net, existing_lesser, existing_greater, existing_layers,
    same_out, cross_out, changes_out, lesser_out, greater_out, layers_out, flags_out,
    count, existing_length, current_port, current_region, net, goal, existing_count);
  return count;
}
