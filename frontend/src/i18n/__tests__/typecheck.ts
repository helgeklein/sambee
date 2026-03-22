import { useTranslation } from "react-i18next";
import { translate } from "../index";

void translate("app.loading");
void translate("settings.userManagement.totalUsers", { count: 2 });

// @ts-expect-error Invalid frontend translation keys must fail typecheck.
void translate("app.missingKey");

function FrontendI18nTypecheckFixture() {
  const { t } = useTranslation();

  void t("app.loading");
  void t("settings.userManagement.totalUsers", { count: 2 });

  // @ts-expect-error Invalid react-i18next keys must fail typecheck.
  void t("settings.userManagement.missingKey");

  return null;
}

void FrontendI18nTypecheckFixture;
