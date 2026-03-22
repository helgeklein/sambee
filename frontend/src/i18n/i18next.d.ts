import "i18next";
import type { FrontendTranslations } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: FrontendTranslations;
    };
  }
}
