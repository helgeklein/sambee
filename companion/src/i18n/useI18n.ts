import { useEffect, useState } from "preact/hooks";
import i18n, { getCurrentLanguage, translate } from "./index";

export function useI18n() {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const handleLanguageChanged = () => {
      setRevision((current) => current + 1);
    };

    i18n.on("languageChanged", handleLanguageChanged);

    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, []);

  return {
    language: getCurrentLanguage(),
    t: translate as typeof translate,
  };
}
