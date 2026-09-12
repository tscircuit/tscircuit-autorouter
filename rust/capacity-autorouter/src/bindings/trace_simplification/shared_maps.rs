use std::{cell::OnceCell, ops::Deref, rc::Rc};
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

struct Version<T> { value: T, next: OnceCell<Box<Version<T>>> }

// Prior versions keep borrowed values valid across explicit host callbacks.
pub struct SharedValue<T>(Rc<Version<T>>, Option<u64>);

impl<T> SharedValue<T> {
    pub fn new(value: T) -> Self { Self(Rc::new(Version { value, next: OnceCell::new() }), None) }
    pub(crate) fn with_identity(value: T, identity: u64) -> Self {
        Self(Rc::new(Version { value, next: OnceCell::new() }), Some(identity))
    }
    pub(crate) fn source_identity(&self) -> Option<u64> { self.1 }
    fn current(&self) -> &Version<T> {
        let mut current = self.0.as_ref();
        while let Some(next) = current.next.get() { current = next; }
        current
    }
    pub fn replace(&self, value: T) {
        assert!(self.current().next.set(Box::new(Version { value, next: OnceCell::new() })).is_ok());
    }
}
impl<T> Deref for SharedValue<T> {
    type Target = T;
    fn deref(&self) -> &T { &self.current().value }
}
impl<T> Clone for SharedValue<T> {
    fn clone(&self) -> Self { Self(self.0.clone(), self.1) }
}
impl<T: Serialize> Serialize for SharedValue<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok,S::Error> { self.current().value.serialize(serializer) }
}
impl<'de,T: Deserialize<'de>> Deserialize<'de> for SharedValue<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self,D::Error> { T::deserialize(deserializer).map(Self::new) }
}

pub type LayerSet = SharedValue<Vec<f64>>;
pub type TerminalLayers = SharedValue<IndexMap<String,Rc<LayerSet>>>;
pub type NetByConnectionName = SharedValue<IndexMap<String,String>>;
