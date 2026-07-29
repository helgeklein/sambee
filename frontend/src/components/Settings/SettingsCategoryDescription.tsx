import { Link } from "@mui/material";
import { Trans } from "react-i18next";
import { getSettingsCategoryDescriptionKey, type SettingsCategory } from "./settingsNavigation";

const OIDC_SETUP_GUIDE_URL = "https://sambee.net/mr/help-oidc-setup";

interface SettingsCategoryDescriptionProps {
  category: SettingsCategory;
}

export function SettingsCategoryDescription({ category }: SettingsCategoryDescriptionProps) {
  return (
    <Trans
      i18nKey={getSettingsCategoryDescriptionKey(category)}
      components={
        category === "admin-authentication" ? { guide: <Link href={OIDC_SETUP_GUIDE_URL} target="_blank" rel="noreferrer" /> } : undefined
      }
    />
  );
}
