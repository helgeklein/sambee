//! Tauri commands for companion-side pairing approval.

use std::sync::Arc;

use log::info;
use tauri::State;

use crate::server::pairing::PairingState;

/// Mark a pending pairing as approved on the companion side.
#[tauri::command]
pub fn confirm_pending_pairing(pairing_state: State<'_, Arc<PairingState>>, pairing_id: String) -> Result<(), String> {
    pairing_state.companion_confirm(&pairing_id)?;
    info!("Pairing approved from companion UI: {}", pairing_id);
    Ok(())
}

/// Reject and discard a pending pairing on the companion side.
#[tauri::command]
pub fn reject_pending_pairing(pairing_state: State<'_, Arc<PairingState>>, pairing_id: String) -> Result<(), String> {
    pairing_state.companion_reject(&pairing_id);
    info!("Pairing rejected from companion UI: {}", pairing_id);
    Ok(())
}

/// Return all paired browser origins currently trusted for local-drive access.
#[tauri::command]
pub fn get_paired_origins(pairing_state: State<'_, Arc<PairingState>>) -> Vec<String> {
    pairing_state.get_paired_origins()
}

/// Remove a previously paired browser origin.
#[tauri::command]
pub fn unpair_origin(pairing_state: State<'_, Arc<PairingState>>, origin: String) -> Result<(), String> {
    pairing_state.unpair(&origin)?;
    info!("Paired origin removed from companion preferences: {}", origin);
    Ok(())
}
