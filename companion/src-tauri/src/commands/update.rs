//! Tauri commands for channel-aware Companion self-updates.

use log::info;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const RELEASE_FEED_BASE_URL: &str = "https://release-feeds.sambee.net/feeds/companion/tauri";

#[derive(Clone, Copy)]
enum UpdateChannel {
    Stable,
    Beta,
    Test,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionUpdateStatus {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
}

impl CompanionUpdateStatus {
    fn unavailable(current_version: String) -> Self {
        Self {
            available: false,
            current_version,
            version: None,
            notes: None,
            published_at: None,
        }
    }

    fn available(update: &tauri_plugin_updater::Update) -> Self {
        let published_at = update
            .raw_json
            .get("pub_date")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .or_else(|| update.date.map(|value| value.to_string()));

        Self {
            available: true,
            current_version: update.current_version.clone(),
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            published_at,
        }
    }
}

impl UpdateChannel {
    fn parse(channel: &str) -> Result<Self, String> {
        match channel {
            "stable" => Ok(Self::Stable),
            "beta" => Ok(Self::Beta),
            "test" => Ok(Self::Test),
            _ => Err(format!("Unsupported update channel: {channel}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Test => "test",
        }
    }

    fn endpoint_url(self) -> Result<Url, String> {
        Url::parse(&format!("{}/{}/latest.json", RELEASE_FEED_BASE_URL, self.as_str()))
            .map_err(|err| format!("Invalid updater endpoint for {}: {err}", self.as_str()))
    }
}

async fn check_for_update_internal(app: &AppHandle, channel: UpdateChannel) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let endpoint = channel.endpoint_url()?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|err| format!("Failed to configure updater endpoint: {err}"))?
        .build()
        .map_err(|err| format!("Failed to build updater: {err}"))?;

    updater.check().await.map_err(|err| format!("Failed to check for updates: {err}"))
}

#[tauri::command]
pub async fn check_for_companion_update(app: AppHandle, channel: String) -> Result<CompanionUpdateStatus, String> {
    let channel = UpdateChannel::parse(&channel)?;
    let current_version = app.package_info().version.to_string();
    let update = check_for_update_internal(&app, channel).await?;

    if let Some(update) = update {
        info!(
            "Companion update available on {} channel: {} -> {}",
            channel.as_str(),
            update.current_version,
            update.version
        );
        Ok(CompanionUpdateStatus::available(&update))
    } else {
        Ok(CompanionUpdateStatus::unavailable(current_version))
    }
}

#[tauri::command]
pub async fn install_companion_update(app: AppHandle, channel: String) -> Result<(), String> {
    let channel = UpdateChannel::parse(&channel)?;
    let Some(update) = check_for_update_internal(&app, channel).await? else {
        return Ok(());
    };

    info!("Installing companion update from {} channel: {}", channel.as_str(), update.version);

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("Failed to download and install update: {err}"))
}
