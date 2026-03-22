import "i18next";
import type { CompanionTranslations } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: CompanionTranslations;
    };
  }
}
