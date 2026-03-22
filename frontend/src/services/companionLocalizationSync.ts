import { getCurrentLanguage, getCurrentRegionalLocale } from "../i18n";
import companionService, { hasStoredSecret } from "./companion";
import { logger } from "./logger";

export async function syncCurrentLocalizationToCompanion(): Promise<void> {
  if (!hasStoredSecret()) {
    return;
  }

  try {
    await companionService.syncLocalization({
      language: getCurrentLanguage(),
      regional_locale: getCurrentRegionalLocale(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn("Failed to sync localization to companion", { error }, "companion");
  }
}
