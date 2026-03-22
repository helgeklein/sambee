import { translate } from "../index";
import { useI18n } from "../useI18n";

void translate("app.title");
void translate("preferences.confirmUnpair.body", { origin: "https://example.test" });

// @ts-expect-error Invalid companion translation keys must fail typecheck.
void translate("app.missingKey");

function CompanionI18nTypecheckFixture() {
  const { t } = useI18n();

  void t("app.title");
  void t("preferences.confirmUnpair.body", { origin: "https://example.test" });

  // @ts-expect-error Invalid useI18n keys must fail typecheck.
  void t("preferences.missingKey");

  return null;
}

void CompanionI18nTypecheckFixture;
