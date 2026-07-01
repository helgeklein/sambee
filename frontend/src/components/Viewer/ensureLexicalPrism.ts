let prismReady = false;
let prismSetupPromise: Promise<void> | null = null;

type PrismGlobal = typeof globalThis & {
  Prism?: unknown;
};

const PRISM_LANGUAGE_MODULES = [
  "prismjs/components/prism-clike",
  "prismjs/components/prism-javascript",
  "prismjs/components/prism-markup",
  "prismjs/components/prism-markdown",
  "prismjs/components/prism-c",
  "prismjs/components/prism-css",
  "prismjs/components/prism-objectivec",
  "prismjs/components/prism-sql",
  "prismjs/components/prism-powershell",
  "prismjs/components/prism-python",
  "prismjs/components/prism-rust",
  "prismjs/components/prism-swift",
  "prismjs/components/prism-typescript",
  "prismjs/components/prism-java",
  "prismjs/components/prism-cpp",
] as const;

export async function ensureLexicalPrism(): Promise<void> {
  if (prismReady) {
    return;
  }

  if (prismSetupPromise) {
    return prismSetupPromise;
  }

  prismSetupPromise = (async () => {
    try {
      const prismModule = await import("prismjs");
      const prismInstance = prismModule.default ?? prismModule;
      const prismGlobal = globalThis as PrismGlobal;

      prismGlobal.Prism = prismInstance;

      if (typeof window !== "undefined") {
        (window as Window & { Prism?: unknown }).Prism = prismInstance;
      }

      for (const languageModule of PRISM_LANGUAGE_MODULES) {
        await import(languageModule);
      }

      prismReady = true;
    } catch (error) {
      prismSetupPromise = null;
      throw error;
    }
  })();

  return prismSetupPromise;
}

export function resetLexicalPrismForRetry(): void {
  prismReady = false;
  prismSetupPromise = null;
}
