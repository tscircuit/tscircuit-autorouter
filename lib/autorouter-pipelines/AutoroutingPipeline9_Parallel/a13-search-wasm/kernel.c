// Portable A13 A* kernel. Compile without fast-math: operation and heap tie
// ordering deliberately match the TypeScript implementation.
typedef unsigned char u8;
typedef unsigned short u16;
// A per-state version identifies stale entries just like comparing saved g
// against distance[index], but makes each heap entry fit in one 16-byte copy.
typedef struct {
  double f;
  int index;
  unsigned int version;
} Entry;
_Static_assert(sizeof(Entry) == 16,
               "Heap entry ABI must match the TS allocator");
typedef struct {
  int index;
  double g;
} Candidate;
static int cols, rows, layers, plane, states, goal, heap_size, heap_capacity;
static int expansions, pops;
static double pitch_x, pitch_y, present_cost;
static u16 *trace_cost, *via_cost;
static u8 *fixed, *fixed_via, *via_allowed;
static double *history, *via_history, *heuristic, *distance;
static int *parent, *state_xy, *state_flags;
static unsigned int *versions;
static Entry *heap;

void configure(int c, int r, int l, double px, double py, int *addresses,
               int capacity) {
  cols = c;
  rows = r;
  layers = l;
  plane = c * r;
  states = plane * l;
  pitch_x = px;
  pitch_y = py;
  heap_capacity = capacity;
  trace_cost = (u16 *)addresses[0];
  via_cost = (u16 *)addresses[1];
  fixed = (u8 *)addresses[2];
  fixed_via = (u8 *)addresses[3];
  history = (double *)addresses[4];
  via_history = (double *)addresses[5];
  heuristic = (double *)addresses[6];
  via_allowed = (u8 *)addresses[7];
  distance = (double *)addresses[8];
  parent = (int *)addresses[9];
  state_xy = (int *)addresses[10];
  state_flags = (int *)addresses[11];
  versions = (unsigned int *)addresses[12];
  heap = (Entry *)addresses[13];
  for (int i = 0; i < states; i++) {
    int xy = i % plane, col = xy % cols, row = xy / cols, z = i / plane;
    state_xy[i] = xy;
    state_flags[i] = (col > 0) | ((col + 1 < cols) << 1) | ((row > 0) << 2) |
                     ((row + 1 < rows) << 3) | ((z % 2) << 4);
  }
}
void set_heap_capacity(int capacity) { heap_capacity = capacity; }
int get_expansions(void) { return expansions; }
int get_pops(void) { return pops; }

static void push(int index, double f) {
  int i = heap_size++;
  while (i > 0) {
    int p = (i - 1) >> 1;
    if (heap[p].f <= f)
      break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = (Entry){f, index, ++versions[index]};
}
static Entry pop(void) {
  Entry first = heap[0], last = heap[--heap_size];
  if (!heap_size)
    return first;
  int i = 0;
  while (i * 2 + 1 < heap_size) {
    int child = i * 2 + 1;
    if (child + 1 < heap_size && heap[child + 1].f < heap[child].f)
      child++;
    if (last.f <= heap[child].f)
      break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return first;
}
void begin_search(int start, int end, double present) {
  goal = end;
  present_cost = present;
  heap_size = 0;
  for (int i = 0; i < states; i++) {
    distance[i] = __builtin_inf();
    parent[i] = -1;
    versions[i] = 0;
  }
  distance[start] = 0;
  push(start, heuristic[start]);
}
static void visit(int next, double base, int via, int xy, Candidate current) {
  // Congestion/history are nonnegative. Reject a provably non-improving
  // neighbor before loading those costs, without changing any queue entries.
  double base_g = current.g + base;
  if (base_g >= distance[next])
    return;
  if (fixed[next] && next != goal)
    return;
  if (via && fixed_via[xy])
    return;
  double congestion = via ? via_cost[xy] : trace_cost[next];
  double past = via ? via_history[xy] : history[next];
  double g = base_g + present_cost * congestion + past;
  if (g >= distance[next])
    return;
  distance[next] = g;
  parent[next] = current.index;
  push(next, g + heuristic[next]);
}
// 0=chunk complete, 1=goal, 2=no path, 3=budget, 4=grow heap and resume.
int run(int steps, int budget) {
  expansions = 0;
  pops = 0;
  while (pops < steps) {
    if (expansions >= budget)
      return 3;
    if (!heap_size)
      return 2;
    // Reserve before popping so growing/resuming cannot change queue order.
    if (heap_size + 4 + layers > heap_capacity)
      return 4;
    Entry entry = pop();
    pops++;
    if (entry.version != versions[entry.index])
      continue;
    Candidate current = {entry.index, distance[entry.index]};
    expansions++;
    if (current.index == goal)
      return 1;
    int xy = state_xy[current.index], flags = state_flags[current.index];
    double horizontal = pitch_x * (flags & 16 ? 1.05 : 1);
    double vertical = pitch_y * (flags & 16 ? 1 : 1.05);
    if (flags & 1)
      visit(current.index - 1, horizontal, 0, 0, current);
    if (flags & 2)
      visit(current.index + 1, horizontal, 0, 0, current);
    if (flags & 4)
      visit(current.index - cols, vertical, 0, 0, current);
    if (flags & 8)
      visit(current.index + cols, vertical, 0, 0, current);
    if (via_allowed[xy])
      for (int layer = 0; layer < layers; layer++)
        if (layer * plane + xy != current.index)
          visit(layer * plane + xy, 0.8, 1, xy, current);
  }
  return 0;
}
