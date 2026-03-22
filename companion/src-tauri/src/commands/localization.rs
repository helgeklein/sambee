use std::sync::Arc;

use tauri::State;

use crate::server::localization::LocalizationState;
use crate::server::models::CompanionLocalizationState;

#[tauri::command]
pub fn get_synced_localization(localization: State<'_, Arc<LocalizationState>>) -> Option<CompanionLocalizationState> {
    localization.get_current()
}
