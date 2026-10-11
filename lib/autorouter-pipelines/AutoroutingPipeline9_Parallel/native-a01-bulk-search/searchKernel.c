// Bounded active-search derivative of @tscircuit/high-density-a01
// 44005d6b9dde7d93a3d3a4815b4e7c8c52b59d34. MIT; see
// ../high-density-a01-fork/LICENSE. Native f64 arithmetic and work order.
typedef unsigned int u32;
typedef int i32;
typedef unsigned long long u64;
enum { ITER, SEARCH_ITER, SEQ, HEAP_N, NODE_N, RIP_N, CONSUMED, EVENT,
  MOVE_COST, MOVE_RIP, VIA_N, CACHE_NEW_N, MOVE_DIRTY, VIA_DIRTY,
  HEAP_DIRTY_N, GENERATION, PUSHES, POPS, EXPANSIONS, SKIPS };
enum { ROWS, COLS, LAYERS, STAMP, ACTIVE, END_Z, END_ROW, END_COL,
  CELL_MM, PEN_CAP, VIA_COST, RIP_COST, RIP_HISTORY, TRACE_PEN, VIA_PEN,
  GREEDY, MIN_VIA_ROW, MAX_VIA_ROW, MIN_VIA_COL, MAX_VIA_COL,
  CROSS_LAYER, BUDGET, MAX_ITER, LIMIT, OFFSET_N, CONN_N, SQRT_TWO };
enum { LIMIT_EVENT = 0, GOAL_EVENT = 1, BUDGET_EVENT = 2,
  EMPTY_EVENT = 3, CAP_EVENT = 4 };
static double *hf, *hs, *hi, *ng, *nf, *pen, *rip_counts, *meta, *cfg;
static i32 *nz, *nr, *nc, *np, *nh, *rid, *rp, *used, *ports, *diags;
static i32 *drs, *dcs, *friendly, *cache_values, *cache_len, *cache_new, *via_scratch;
static u32 *visited, *heap_flags, *heap_dirty, *cache_present;
static const i32 dir_dr[8] = {-1,-1,-1,0,0,1,1,1};
static const i32 dir_dc[8] = {-1,0,1,-1,1,-1,0,1};

void configure(double *a, double *b, double *c, double *d, double *e,
  double *f, double *g, double *h, double *j, i32 *k, i32 *l, i32 *m,
  i32 *n, i32 *o, i32 *p, i32 *q, i32 *r, i32 *s, i32 *t, i32 *u,
  i32 *v, i32 *w, i32 *x, i32 *y, i32 *z, i32 *aa, u32 *ab,
  u32 *ac, u32 *ad, u32 *ae) {
  hf=a; hs=b; hi=c; ng=d; nf=e; pen=f; rip_counts=g; meta=h; cfg=j;
  nz=k; nr=l; nc=m; np=n; nh=o; rid=p; rp=q; used=r; ports=s; diags=t;
  drs=u; dcs=v; friendly=w; cache_values=x; cache_len=y; cache_new=z;
  via_scratch=aa; visited=ab; heap_flags=ac; heap_dirty=ad; cache_present=ae;
}

static double js_abs(double value) {
  union { double value; u64 bits; } row;
  row.value=value;
  row.bits &= 0x7fffffffffffffffULL;
  return row.value;
}
static double js_min(double a, double b) {
  if (a != a || b != b) return __builtin_nan("");
  if (a == 0 && b == 0) {
    union { double value; u64 bits; } x, y;
    x.value=a; y.value=b; x.bits |= y.bits;
    return x.value;
  }
  return a < b ? a : b;
}
static double js_max(double a, double b) {
  if (a != a || b != b) return __builtin_nan("");
  if (a == 0 && b == 0) {
    union { double value; u64 bits; } x, y;
    x.value=a; y.value=b; x.bits &= y.bits;
    return x.value;
  }
  return a > b ? a : b;
}

static void heap_row(u32 index, double f, double seq, double id) {
  hf[index]=f; hs[index]=seq; hi[index]=id;
  const u32 generation=(u32)meta[GENERATION];
  if (heap_flags[index] != generation) {
    heap_flags[index]=generation;
    heap_dirty[(u32)meta[HEAP_DIRTY_N]]=index;
    meta[HEAP_DIRTY_N]+=1;
  }
}
static void heap_push(double f, double seq, double id) {
  meta[PUSHES]+=1;
  u32 i=(u32)meta[HEAP_N];
  meta[HEAP_N]+=1;
  while (i > 0) {
    u32 p=(i-1)>>1;
    double parent_f=hf[p], parent_seq=hs[p];
    if (parent_f != f ? parent_f < f : parent_seq < seq) break;
    heap_row(i,parent_f,parent_seq,hi[p]);
    i=p;
  }
  heap_row(i,f,seq,id);
}
static u32 heap_pop(void) {
  meta[POPS]+=1;
  u32 out=(u32)hi[0];
  u32 n=(u32)meta[HEAP_N]-1;
  meta[HEAP_N]=n;
  if (n > 0) {
    double f=hf[n], seq=hs[n], id=hi[n];
    u32 i=0;
    while (1) {
      u32 l=i*2+1, r=l+1;
      if (l >= n) break;
      u32 m=l;
      if (r < n && !(hf[l] != hf[r] ? hf[l] < hf[r] : hs[l] < hs[r])) m=r;
      if (f != hf[m] ? f < hf[m] : seq < hs[m]) break;
      heap_row(i,hf[m],hs[m],hi[m]);
      i=m;
    }
    heap_row(i,f,seq,id);
  }
  return out;
}
static i32 contains_rip(i32 head, i32 id) {
  i32 cur=head;
  while (cur >= 0) {
    if (rid[cur] == id) return 1;
    cur=rp[cur];
  }
  return 0;
}
static i32 append_rip(i32 head, i32 id) {
  i32 index=(i32)meta[RIP_N];
  meta[RIP_N]+=1;
  rid[index]=id;
  rp[index]=head;
  return index;
}
static double get_rip_cost(i32 id) {
  double history=cfg[RIP_HISTORY]*rip_counts[id];
  double multiplier=1+history;
  double cost=cfg[RIP_COST]*multiplier;
  return cost;
}
static i32 allow_overlap(i32 owner) {
  // Native negative sentinels have no same-root overlap permission.
  i32 permitted=0;
  if (owner >= 0) permitted=friendly[owner];
  return permitted;
}

static void fill_via(i32 row, i32 col) {
  i32 cols=(i32)cfg[COLS], rows=(i32)cfg[ROWS], active=(i32)cfg[ACTIVE];
  i32 cell=row*cols+col, stride=(i32)cfg[CONN_N], length=0;
  meta[VIA_DIRTY]=1;
  if (cache_present[cell]) {
    length=cache_len[cell];
    for (i32 i=0; i<length; i++) via_scratch[i]=cache_values[cell*stride+i];
    meta[VIA_N]=length;
    return;
  }
  for (i32 z=0; z<(i32)cfg[LAYERS]; z++) {
    i32 base=z*rows*cols;
    for (i32 i=0; i<(i32)cfg[OFFSET_N]; i++) {
      i32 r=row+drs[i], c=col+dcs[i];
      if (r<0 || c<0 || r>=rows || c>=cols) continue;
      i32 occ=used[base+r*cols+c];
      if (occ == -1 || occ == active || allow_overlap(occ)) continue;
      i32 seen=0;
      for (i32 j=0; j<length; j++) if (via_scratch[j] == occ) { seen=1; break; }
      if (!seen) via_scratch[length++]=occ;
    }
  }
  for (i32 i=0; i<length; i++) cache_values[cell*stride+i]=via_scratch[i];
  cache_present[cell]=1;
  cache_len[cell]=length;
  cache_new[(i32)meta[CACHE_NEW_N]]=cell;
  meta[CACHE_NEW_N]+=1;
  meta[VIA_N]=length;
}

static void move_cost(i32 from_z, i32 from_row, i32 from_col,
  i32 to_z, i32 to_row, i32 to_col, i32 ripped) {
  double cost=0;
  i32 head=ripped, cols=(i32)cfg[COLS], rows=(i32)cfg[ROWS], active=(i32)cfg[ACTIVE];
  meta[MOVE_DIRTY]=1;
  if (from_z != to_z) {
    cost+=cfg[VIA_COST];
    cost+=js_min(pen[to_row*cols+to_col],cfg[PEN_CAP]);
    i32 flat=(to_z*rows+to_row)*cols+to_col, fixed=ports[flat];
    i32 is_end=to_z==(i32)cfg[END_Z] && to_row==(i32)cfg[END_ROW] && to_col==(i32)cfg[END_COL];
    if (fixed>=0 && fixed!=active && !allow_overlap(fixed) && !is_end) {
      meta[MOVE_COST]=-1; meta[MOVE_RIP]=head; return;
    }
    fill_via(to_row,to_col);
    for (i32 i=0; i<(i32)meta[VIA_N]; i++) {
      i32 occ=via_scratch[i];
      if (!contains_rip(head,occ)) { cost+=get_rip_cost(occ); head=append_rip(head,occ); }
      cost+=cfg[VIA_PEN];
    }
  } else {
    i32 dr=from_row>to_row ? from_row-to_row : to_row-from_row;
    i32 dc=from_col>to_col ? from_col-to_col : to_col-from_col;
    cost+=(dr+dc>1 ? cfg[SQRT_TWO] : 1)*cfg[CELL_MM];
    cost+=js_min(pen[to_row*cols+to_col],cfg[PEN_CAP]);
    i32 flat=(to_z*rows+to_row)*cols+to_col, fixed=ports[flat];
    i32 is_end=to_z==(i32)cfg[END_Z] && to_row==(i32)cfg[END_ROW] && to_col==(i32)cfg[END_COL];
    if (fixed>=0 && fixed!=active && !allow_overlap(fixed) && !is_end) {
      meta[MOVE_COST]=-1; meta[MOVE_RIP]=head; return;
    }
    i32 occ=used[flat];
    if (occ!=-1 && occ!=active && !allow_overlap(occ)) {
      if (!contains_rip(head,occ)) { cost+=get_rip_cost(occ); head=append_rip(head,occ); }
      cost+=cfg[TRACE_PEN];
    }
    if (dr==1 && dc==1) {
      i32 sq_row=from_row<to_row ? from_row : to_row;
      i32 sq_col=from_col<to_col ? from_col : to_col;
      i32 backslash=(from_row<to_row && from_col<to_col) || (from_row>to_row && from_col>to_col);
      i32 crossing=(backslash ? 0 : 1)^1;
      i32 base=((to_z*(rows-1)+sq_row)*(cols-1)+sq_col)*2;
      i32 crossing_occ=diags[base+crossing];
      if (crossing_occ!=-1 && crossing_occ!=active && !allow_overlap(crossing_occ)) {
        meta[MOVE_COST]=-1; meta[MOVE_RIP]=head; return;
      }
    }
  }
  meta[MOVE_COST]=cost;
  meta[MOVE_RIP]=head;
}

static double heuristic(i32 z, i32 row, i32 col) {
  double dr=js_abs((double)row-cfg[END_ROW]), dc=js_abs((double)col-cfg[END_COL]);
  double manhattan=dr+dc;
  if (z==(i32)cfg[END_Z]) return manhattan*cfg[CELL_MM];
  if (!cfg[CROSS_LAYER]) return manhattan*cfg[CELL_MM]+cfg[VIA_COST];
  double vr1=js_max(cfg[MIN_VIA_ROW],js_min(cfg[MAX_VIA_ROW],row));
  double vc1=js_max(cfg[MIN_VIA_COL],js_min(cfg[MAX_VIA_COL],col));
  double vr2=js_max(cfg[MIN_VIA_ROW],js_min(cfg[MAX_VIA_ROW],cfg[END_ROW]));
  double vc2=js_max(cfg[MIN_VIA_COL],js_min(cfg[MAX_VIA_COL],cfg[END_COL]));
  double via1=js_abs(row-vr1)+js_abs(col-vc1)+js_abs(vr1-cfg[END_ROW])+js_abs(vc1-cfg[END_COL]);
  double via2=js_abs(row-vr2)+js_abs(col-vc2)+js_abs(vr2-cfg[END_ROW])+js_abs(vc2-cfg[END_COL]);
  return js_max(js_min(via1,via2),manhattan)*cfg[CELL_MM]+cfg[VIA_COST];
}
static void enqueue(i32 z, i32 row, i32 col, double g, i32 parent, i32 ripped) {
  move_cost(nz[parent],nr[parent],nc[parent],z,row,col,ripped);
  if (meta[MOVE_COST]<0) return;
  double g2=g+meta[MOVE_COST];
  double f2=g2+heuristic(z,row,col)*cfg[GREEDY];
  i32 index=(i32)meta[NODE_N];
  meta[NODE_N]+=1;
  nz[index]=z; nr[index]=row; nc[index]=col; ng[index]=g2; nf[index]=f2;
  np[index]=parent; nh[index]=(i32)meta[MOVE_RIP];
  double seq=meta[SEQ]; meta[SEQ]+=1;
  heap_push(f2,seq,index);
}

u32 run(void) {
  i32 rows=(i32)cfg[ROWS], cols=(i32)cfg[COLS];
  u32 stamp=(u32)cfg[STAMP];
  meta[CONSUMED]=0; meta[EVENT]=LIMIT_EVENT;
  while (meta[CONSUMED]<cfg[LIMIT]) {
    if (meta[ITER]+1>=cfg[MAX_ITER]) { meta[EVENT]=CAP_EVENT; break; }
    if (meta[SEARCH_ITER]+1>cfg[BUDGET]) { meta[EVENT]=BUDGET_EVENT; break; }
    if (!meta[HEAP_N]) { meta[EVENT]=EMPTY_EVENT; break; }
    u32 index=(u32)hi[0];
    i32 z=nz[index], row=nr[index], col=nc[index];
    u32 cell=(u32)((z*rows+row)*cols+col);
    if (visited[cell]!=stamp && z==(i32)cfg[END_Z] && row==(i32)cfg[END_ROW] && col==(i32)cfg[END_COL]) {
      meta[EVENT]=GOAL_EVENT; break;
    }
    meta[ITER]+=1; meta[SEARCH_ITER]+=1; meta[CONSUMED]+=1;
    heap_pop();
    if (visited[cell]==stamp) { meta[SKIPS]+=1; continue; }
    visited[cell]=stamp;
    meta[EXPANSIONS]+=1;
    double g=ng[index]; i32 ripped=nh[index];
    for (i32 d=0; d<8; d++) {
      i32 r=row+dir_dr[d], c=col+dir_dc[d];
      if (r<0 || r>=rows || c<0 || c>=cols) continue;
      u32 target=(u32)((z*rows+r)*cols+c);
      if (visited[target]==stamp) continue;
      enqueue(z,r,c,g,index,ripped);
    }
    if (row>=cfg[MIN_VIA_ROW] && row<=cfg[MAX_VIA_ROW] && col>=cfg[MIN_VIA_COL] && col<=cfg[MAX_VIA_COL]) {
      for (i32 layer=0; layer<(i32)cfg[LAYERS]; layer++) {
        if (layer==z) continue;
        u32 target=(u32)((layer*rows+row)*cols+col);
        if (visited[target]==stamp) continue;
        enqueue(layer,row,col,g,index,ripped);
      }
    }
  }
  return (u32)meta[CONSUMED];
}
