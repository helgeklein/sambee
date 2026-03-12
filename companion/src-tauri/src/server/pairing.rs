//! Pairing protocol — Bluetooth-style numeric comparison.
//!
//! Establishes a shared secret between the Sambee frontend and the companion
//! via a one-time user-confirmed exchange. The secret is stored in the OS
//! keychain and used to authenticate all subsequent API requests.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use log::{info, warn};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Keyring service name for storing pairing secrets.
const KEYRING_SERVICE: &str = "sambee-companion";

/// Reserved keyring account used to persist the list of paired origins.
const KEYRING_PAIRED_ORIGINS_ACCOUNT: &str = "__paired_origins__";

/// Maximum age of a pending pairing before it expires.
const PAIRING_TIMEOUT: Duration = Duration::from_secs(120);

/// Tracks in-flight pairing attempts and completed pairings.
#[allow(dead_code)]
pub struct PairingState {
    /// Pending pairings awaiting confirmation.
    pending: Mutex<HashMap<String, PendingPairing>>,
    /// Origins that have completed pairing (cached from keychain).
    paired_origins: Mutex<Vec<String>>,
}

/// A pairing attempt in progress.
#[allow(dead_code)]
struct PendingPairing {
    /// The browser's nonce.
    nonce_browser: Vec<u8>,
    /// The companion's nonce.
    nonce_companion: Vec<u8>,
    /// When this pairing was initiated.
    created_at: Instant,
    /// The origin that initiated the pairing (from HTTP Origin header).
    origin: String,
    /// Whether the companion side has been confirmed by the user.
    companion_confirmed: bool,
}

#[allow(dead_code)]
impl PairingState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            paired_origins: Mutex::new(Vec::new()),
        }
    }

    /// Check if any origin is currently paired.
    pub fn has_any_pairing(&self) -> bool {
        let origins = self.paired_origins.lock().unwrap();
        !origins.is_empty()
    }

    /// Check if a specific origin is paired.
    pub fn is_origin_paired(&self, origin: &str) -> bool {
        let origins = self.paired_origins.lock().unwrap();
        origins.contains(&origin.to_string())
    }

    /// Return all currently paired origins.
    pub fn get_paired_origins(&self) -> Vec<String> {
        let origins = self.paired_origins.lock().unwrap();
        origins.clone()
    }

    /// Record an origin that has proven it holds a valid pairing secret.
    pub fn record_verified_origin(&self, origin: &str) {
        let mut origins = self.paired_origins.lock().unwrap();
        if origins.iter().any(|entry| entry == origin) {
            return;
        }

        origins.push(origin.to_string());
        if let Err(e) = store_paired_origins_in_keychain(&origins) {
            warn!("Failed to persist paired origins list after auth for {origin}: {e}");
        }

        info!("Recovered paired origin from successful authenticated request: {origin}");
    }

    /// Start a new pairing: store the browser nonce, generate companion nonce,
    /// return the pairing ID and companion nonce.
    pub fn initiate(&self, nonce_browser_hex: &str, origin: &str) -> Result<(String, String, String), String> {
        let nonce_browser = hex::decode(nonce_browser_hex).map_err(|_| "Invalid hex encoding for nonce_browser".to_string())?;

        if nonce_browser.len() != 32 {
            return Err("nonce_browser must be 32 bytes (64 hex chars)".to_string());
        }

        // Generate companion nonce (32 random bytes)
        let nonce_companion: Vec<u8> = (0..32).map(|_| rand_byte()).collect();
        let nonce_companion_hex = hex::encode(&nonce_companion);

        // Compute pairing code: SHA-256(nonce_browser || nonce_companion), first 6 hex chars uppercased
        let code = compute_pairing_code(&nonce_browser, &nonce_companion);

        let pairing_id = Uuid::new_v4().to_string();

        // Clean up expired pairings
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.created_at.elapsed() < PAIRING_TIMEOUT);

        pending.insert(
            pairing_id.clone(),
            PendingPairing {
                nonce_browser,
                nonce_companion,
                created_at: Instant::now(),
                origin: origin.to_string(),
                companion_confirmed: false,
            },
        );

        info!("Pairing initiated: id={pairing_id}, origin={origin}, code={code}");

        Ok((pairing_id, nonce_companion_hex, code))
    }

    /// Mark the companion side of a pairing as confirmed by the user.
    pub fn companion_confirm(&self, pairing_id: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        let pairing = pending
            .get_mut(pairing_id)
            .ok_or_else(|| "Unknown or expired pairing".to_string())?;

        if pairing.created_at.elapsed() >= PAIRING_TIMEOUT {
            pending.remove(pairing_id);
            return Err("Pairing has expired".to_string());
        }

        pairing.companion_confirmed = true;
        info!("Pairing companion-confirmed: id={pairing_id}");
        Ok(())
    }

    /// Mark the companion side of a pairing as rejected by the user.
    pub fn companion_reject(&self, pairing_id: &str) {
        let mut pending = self.pending.lock().unwrap();
        pending.remove(pairing_id);
        info!("Pairing companion-rejected: id={pairing_id}");
    }

    /// Complete the pairing: verify the companion confirmed, generate shared secret,
    /// store it in the keychain, and return it to the browser.
    pub fn confirm(&self, pairing_id: &str) -> Result<String, String> {
        let mut pending = self.pending.lock().unwrap();
        let pairing = pending.remove(pairing_id).ok_or_else(|| "Unknown or expired pairing".to_string())?;

        if pairing.created_at.elapsed() >= PAIRING_TIMEOUT {
            return Err("Pairing has expired".to_string());
        }

        if !pairing.companion_confirmed {
            // Put it back — the frontend confirmed but the companion hasn't yet
            let id = pairing_id.to_string();
            pending.insert(id, pairing);
            return Err("Waiting for companion confirmation".to_string());
        }

        drop(pending); // Release lock before keychain operations

        // Generate shared secret
        let secret_bytes: Vec<u8> = (0..32).map(|_| rand_byte()).collect();
        let secret_hex = hex::encode(&secret_bytes);

        // Store in OS keychain
        if let Err(e) = store_secret_in_keychain(&pairing.origin, &secret_hex) {
            warn!("Failed to store secret in keychain: {e}");
            return Err(format!("Failed to store pairing secret: {e}"));
        }

        // Add to cached paired origins
        self.record_verified_origin(&pairing.origin);

        info!("Pairing completed: origin={}", pairing.origin);
        Ok(secret_hex)
    }

    /// Load paired origins from the keychain on startup.
    pub fn load_from_keychain(&self) {
        let stored_origins = match load_paired_origins_from_keychain() {
            Ok(origins) => origins,
            Err(e) => {
                warn!("Failed to load paired origins from keychain: {e}");
                Vec::new()
            }
        };

        let mut verified_origins = Vec::new();
        for origin in stored_origins {
            if get_secret_from_keychain(&origin).is_ok() {
                verified_origins.push(origin);
            } else {
                warn!("Skipping paired origin without readable secret in keychain");
            }
        }

        if let Ok(mut origins) = self.paired_origins.lock() {
            *origins = verified_origins.clone();
        }

        if let Err(e) = store_paired_origins_in_keychain(&verified_origins) {
            warn!("Failed to resync paired origins list in keychain: {e}");
        }

        info!("Pairing state initialized with {} paired origin(s)", verified_origins.len());
    }

    /// Retrieve the stored secret for an origin from the keychain.
    pub fn get_secret_for_origin(&self, origin: &str) -> Option<String> {
        get_secret_from_keychain(origin).ok()
    }

    /// Get a pending pairing by ID (for the companion UI to display the code).
    pub fn get_pending_code(&self, pairing_id: &str) -> Option<String> {
        let pending = self.pending.lock().unwrap();
        pending
            .get(pairing_id)
            .map(|p| compute_pairing_code(&p.nonce_browser, &p.nonce_companion))
    }

    /// Get all pending pairing IDs and their origins (for the companion UI).
    pub fn get_pending_pairings(&self) -> Vec<(String, String, String)> {
        let pending = self.pending.lock().unwrap();
        pending
            .iter()
            .filter(|(_, p)| p.created_at.elapsed() < PAIRING_TIMEOUT && !p.companion_confirmed)
            .map(|(id, p)| {
                let code = compute_pairing_code(&p.nonce_browser, &p.nonce_companion);
                (id.clone(), p.origin.clone(), code)
            })
            .collect()
    }

    /// Remove pairing for a specific origin.
    pub fn unpair(&self, origin: &str) -> Result<(), String> {
        // Remove from keychain
        if let Err(e) = delete_secret_from_keychain(origin) {
            warn!("Failed to remove secret from keychain for {origin}: {e}");
        }

        // Remove from cached list
        let mut origins = self.paired_origins.lock().unwrap();
        origins.retain(|o| o != origin);
        if let Err(e) = store_paired_origins_in_keychain(&origins) {
            warn!("Failed to persist paired origins list after unpair: {e}");
        }

        info!("Unpaired origin: {origin}");
        Ok(())
    }
}

/// Compute the 6-character pairing code from both nonces.
fn compute_pairing_code(nonce_browser: &[u8], nonce_companion: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(nonce_browser);
    hasher.update(nonce_companion);
    let hash = hasher.finalize();
    hex::encode(&hash[..3]).to_uppercase()
}

// ─── Keychain operations ─────────────────────────────────────────────────────

/// Store a pairing secret in the OS keychain.
fn store_secret_in_keychain(origin: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, origin).map_err(|e| format!("Keyring entry creation failed: {e}"))?;
    entry
        .set_password(secret)
        .map_err(|e| format!("Keyring set_password failed: {e}"))?;
    Ok(())
}

/// Persist the list of paired origins in the OS keychain.
fn store_paired_origins_in_keychain(origins: &[String]) -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_PAIRED_ORIGINS_ACCOUNT).map_err(|e| format!("Keyring entry creation failed: {e}"))?;
    let serialized = serde_json::to_string(origins).map_err(|e| format!("Failed to serialize paired origins: {e}"))?;
    entry
        .set_password(&serialized)
        .map_err(|e| format!("Keyring set_password failed: {e}"))?;
    Ok(())
}

/// Load the persisted list of paired origins from the OS keychain.
fn load_paired_origins_from_keychain() -> Result<Vec<String>, String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_PAIRED_ORIGINS_ACCOUNT).map_err(|e| format!("Keyring entry creation failed: {e}"))?;
    let serialized = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(Vec::new()),
        Err(e) => return Err(format!("Keyring get_password failed: {e}")),
    };

    serde_json::from_str(&serialized).map_err(|e| format!("Failed to deserialize paired origins: {e}"))
}

/// Retrieve a pairing secret from the OS keychain.
fn get_secret_from_keychain(origin: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, origin).map_err(|e| format!("Keyring entry creation failed: {e}"))?;
    entry.get_password().map_err(|e| format!("Keyring get_password failed: {e}"))
}

/// Delete a pairing secret from the OS keychain.
#[allow(dead_code)]
fn delete_secret_from_keychain(origin: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, origin).map_err(|e| format!("Keyring entry creation failed: {e}"))?;
    entry.delete_credential().map_err(|e| format!("Keyring delete failed: {e}"))
}

/// Generate a single random byte using a simple entropy source.
///
/// Uses `uuid::Uuid::new_v4()` as a source of randomness since we already
/// depend on the `uuid` crate. For security-critical randomness in production,
/// consider the `getrandom` crate directly.
fn rand_byte() -> u8 {
    // Use the first byte of a v4 UUID as a random byte source
    Uuid::new_v4().as_bytes()[0]
}
