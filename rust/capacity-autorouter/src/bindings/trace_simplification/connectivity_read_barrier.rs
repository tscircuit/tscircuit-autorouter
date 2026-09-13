use crate::bindings::trace_simplification::types::ConnectivityMap;
use std::cell::RefCell;
use std::rc::Rc;

pub type ReadHook = Rc<dyn Fn(&Rc<ConnectivityMap>) -> Result<(), String>>;

thread_local! {
    static READ_HOOK: RefCell<Option<(ReadHook, Vec<Rc<ConnectivityMap>>)>> = RefCell::new(None);
}

pub struct ReadScope {
    previous: Option<(ReadHook, Vec<Rc<ConnectivityMap>>)>,
}

impl ReadScope {
    pub fn new(hook: ReadHook, maps: Vec<Rc<ConnectivityMap>>) -> Self {
        let previous = READ_HOOK.with(|slot| slot.replace(Some((hook, maps))));
        Self { previous }
    }
}

impl Drop for ReadScope {
    fn drop(&mut self) {
        READ_HOOK.with(|slot| {
            slot.replace(self.previous.take());
        });
    }
}

pub fn check(map: &Rc<ConnectivityMap>) -> Result<(), String> {
    let hook = READ_HOOK.with(|slot| slot.borrow().as_ref().map(|(hook, _)| hook.clone()));
    match hook {
        Some(hook) => hook(map),
        None => Ok(()),
    }
}

pub fn check_all() -> Result<(), String> {
    let current = READ_HOOK.with(|slot| slot.borrow().clone());
    if let Some((hook, maps)) = current {
        for map in maps {
            hook(&map)?;
        }
    }
    Ok(())
}
