import { invoke } from "@tauri-apps/api/core";

import type { LifecycleErrorStatus } from "./tauriErrorMarkers";

export async function openSambeeStatusPage(serverUrl: string, status: LifecycleErrorStatus) {
  await invoke("open_sambee_status_page", {
    serverUrl,
    status,
  });
}
