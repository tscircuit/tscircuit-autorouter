use super::{HeapEntry, MinHeap};

#[derive(Default)]
struct SwapHeap { entries: Vec<HeapEntry>, n: usize }

impl SwapHeap {
    fn less(&self, i: usize, j: usize) -> bool {
        let fi = self.entries[i].f;
        let fj = self.entries[j].f;
        if fi != fj { return fi < fj; }
        self.entries[i].seq < self.entries[j].seq
    }

    fn push(&mut self, entry: HeapEntry) {
        let mut i = self.n;
        self.n += 1;
        if i == self.entries.len() { self.entries.push(entry); }
        else { self.entries[i] = entry; }
        while i > 0 {
            let p = (i - 1) >> 1;
            if self.less(p,i) { break; }
            self.entries.swap(i,p);
            i = p;
        }
    }

    fn pop(&mut self) -> usize {
        let result = self.entries[0].id;
        self.n -= 1;
        if self.n > 0 {
            self.entries[0] = self.entries[self.n];
            let mut i = 0;
            loop {
                let l = i * 2 + 1;
                let r = l + 1;
                if l >= self.n { break; }
                let mut m = l;
                if r < self.n && !self.less(l,r) { m = r; }
                if self.less(i,m) { break; }
                self.entries.swap(i,m);
                i = m;
            }
        }
        result
    }
}

#[test]
fn held_entry_sifts_match_original_swap_heap_for_special_values_and_interleaving() {
    let values = [0.0,-0.0,1.0,1.0,-1.0,f64::INFINITY,f64::NEG_INFINITY,f64::NAN,2.5];
    let mut actual = MinHeap::default();
    let mut reference = SwapHeap::default();
    for id in 0..3000 {
        if id % 1000 == 999 { actual.n=0; reference.n=0; }
        else if id % 3 == 2 && reference.n > 0 { assert_eq!(actual.pop(),reference.pop()); }
        else {
            let entry = HeapEntry {f:values[(id*7)%values.len()],seq:(id%7) as usize,id};
            actual.push(entry.f,entry.seq,entry.id);
            reference.push(entry);
        }
        assert_eq!(actual.n,reference.n);
        for (a,b) in actual.entries[..actual.n].iter().zip(&reference.entries[..reference.n]) {
            assert_eq!((a.id,a.seq,a.f.to_bits()),(b.id,b.seq,b.f.to_bits()));
        }
    }
    while reference.n > 0 { assert_eq!(actual.pop(),reference.pop()); }
}
