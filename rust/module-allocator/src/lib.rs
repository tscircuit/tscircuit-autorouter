#![no_std]
#![cfg(all(target_arch = "wasm32", target_os = "unknown"))]

#[cfg(target_feature = "atomics")]
compile_error!("The WASM allocator requires single-threaded memory without atomics");

use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use dlmalloc::Dlmalloc;

pub struct ModuleAllocator(UnsafeCell<Dlmalloc>);

impl ModuleAllocator {
    pub const fn new() -> Self {
        let mut allocator = Dlmalloc::new();
        // Fewer memory.grow calls avoid repeatedly charging the entire refreshed
        // ArrayBuffer to JavaScriptCore's GC allocation budget.
        assert!(allocator.set_granularity(8 * 1024 * 1024));
        Self(UnsafeCell::new(allocator))
    }
}

// SAFETY: This crate is used only by wasm32-unknown-unknown modules without
// atomics or shared memory. Allocation executes on one thread, and dlmalloc's
// WASM system allocator does not call user code, so allocator access cannot
// overlap or reenter. Atomics builds are rejected above instead of racing.
unsafe impl Sync for ModuleAllocator {}

// SAFETY: Each operation forwards the caller's GlobalAlloc pointer/layout
// contract directly to dlmalloc while holding exclusive single-thread access.
unsafe impl GlobalAlloc for ModuleAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { (&mut *self.0.get()).malloc(layout.size(), layout.align()) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        unsafe { (&mut *self.0.get()).calloc(layout.size(), layout.align()) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { (&mut *self.0.get()).free(pointer, layout.size(), layout.align()) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        unsafe { (&mut *self.0.get()).realloc(pointer, layout.size(), layout.align(), new_size) }
    }
}
