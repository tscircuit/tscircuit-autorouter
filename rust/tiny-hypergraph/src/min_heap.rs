pub struct MinHeap<T> {
    items: Vec<T>,
    compare: Box<dyn Fn(&T, &T) -> f64>,
}

impl<T: Clone> MinHeap<T> {
    pub fn new(items: Vec<T>, compare: impl Fn(&T, &T) -> f64 + 'static) -> Self {
        Self {
            items,
            compare: Box::new(compare),
        }
    }

    pub fn length(&self) -> usize {
        self.items.len()
    }

    pub fn to_array(&self) -> Vec<T> {
        self.items.clone()
    }

    pub fn clear(&mut self) -> () {
        self.items.clear();
    }

    pub fn queue(&mut self, item: T) -> () {
        self.items.push(item);
        self.sift_up(self.items.len() - 1);
    }

    pub fn dequeue(&mut self) -> Option<T> {
        let best = self.items.first()?.clone();
        let last = self.items.pop().unwrap();
        if !self.items.is_empty() {
            self.items[0] = last;
            self.sift_down(0);
        }

        Some(best)
    }

    fn sift_up(&mut self, start_index: usize) -> () {
        let mut index = start_index;

        while index > 0 {
            let parent_index = (index - 1) >> 1;
            if (self.compare)(&self.items[parent_index], &self.items[index]) <= 0.0 {
                return;
            }

            self.items.swap(index, parent_index);
            index = parent_index;
        }
    }

    fn sift_down(&mut self, start_index: usize) -> () {
        let mut index = start_index;

        loop {
            let left = index * 2 + 1;
            if left >= self.items.len() {
                return;
            }

            let right = left + 1;
            let smallest = if right < self.items.len()
                && (self.compare)(&self.items[right], &self.items[left]) < 0.0
            {
                right
            } else {
                left
            };
            if (self.compare)(&self.items[index], &self.items[smallest]) <= 0.0 {
                return;
            }

            self.items.swap(index, smallest);
            index = smallest;
        }
    }
}
