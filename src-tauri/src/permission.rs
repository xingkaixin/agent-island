use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{oneshot, Mutex};

use crate::session::PermissionRequestView;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDecision {
    pub decision: String,
    pub reason: Option<String>,
}

#[derive(Debug)]
pub enum PermissionError {
    NotFound,
    AlreadyResolved,
    ReceiveFailed,
}

impl Display for PermissionError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionError::NotFound => write!(f, "permission request not found"),
            PermissionError::AlreadyResolved => write!(f, "permission request already resolved"),
            PermissionError::ReceiveFailed => write!(f, "failed to receive permission decision"),
        }
    }
}

struct PendingPermission {
    request: PermissionRequestView,
    sender: Option<oneshot::Sender<PermissionDecision>>,
    receiver: Arc<Mutex<Option<oneshot::Receiver<PermissionDecision>>>>,
}

pub struct PermissionStore {
    pending: HashMap<String, PendingPermission>,
}

pub type PermissionReceiverHandle = Arc<Mutex<Option<oneshot::Receiver<PermissionDecision>>>>;

impl PermissionStore {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    pub fn register(&mut self, request: PermissionRequestView) -> Result<(), PermissionError> {
        let (sender, receiver) = oneshot::channel();
        self.pending.insert(
            request.request_id.clone(),
            PendingPermission {
                request,
                sender: Some(sender),
                receiver: Arc::new(Mutex::new(Some(receiver))),
            },
        );
        Ok(())
    }

    pub fn current_request(&self) -> Option<PermissionRequestView> {
        self.pending
            .values()
            .map(|pending| pending.request.clone())
            .min_by_key(|request| request.created_at)
    }

    pub fn resolve(
        &mut self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<(), PermissionError> {
        let pending = self.pending.get_mut(request_id).ok_or(PermissionError::NotFound)?;
        let sender = pending.sender.take().ok_or(PermissionError::AlreadyResolved)?;
        sender.send(decision).map_err(|_| PermissionError::AlreadyResolved)
    }

    pub fn wait_for_resolution(
        receiver: PermissionReceiverHandle,
    ) -> Result<PermissionDecision, PermissionError> {
        tauri::async_runtime::block_on(async move {
            let mut guard = receiver.lock().await;
            let rx = guard.take().ok_or(PermissionError::AlreadyResolved)?;
            rx.await.map_err(|_| PermissionError::ReceiveFailed)
        })
    }

    pub fn receiver_for(
        &self,
        request_id: &str,
    ) -> Result<PermissionReceiverHandle, PermissionError> {
        Ok(self
            .pending
            .get(request_id)
            .ok_or(PermissionError::NotFound)?
            .receiver
            .clone())
    }

    pub fn remove(&mut self, request_id: &str) {
        self.pending.remove(request_id);
    }
}
