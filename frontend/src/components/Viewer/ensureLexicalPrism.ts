let prismReady = false;
let prismSetupPromise: Promise<void> | null = null;

type PrismGlobal = typeof globalThis & {
  Prism?: unknown;
};

const PRISM_LANGUAGE_LOADERS = [
  // Keep these as explicit import expressions so Vite can rewrite and bundle
  // the Prism component modules for the browser. `import(someVariable)` with
  // bare package specifiers leaves resolution to the runtime loader and fails
  // in edit mode.
  () => import("prismjs/components/prism-clike.js"),
  () => import("prismjs/components/prism-javascript.js"),
  () => import("prismjs/components/prism-markup.js"),
  () => import("prismjs/components/prism-markdown.js"),
  () => import("prismjs/components/prism-c.js"),
  () => import("prismjs/components/prism-css.js"),
  () => import("prismjs/components/prism-objectivec.js"),
  () => import("prismjs/components/prism-sql.js"),
  () => import("prismjs/components/prism-powershell.js"),
  () => import("prismjs/components/prism-python.js"),
  () => import("prismjs/components/prism-rust.js"),
  () => import("prismjs/components/prism-swift.js"),
  () => import("prismjs/components/prism-typescript.js"),
  () => import("prismjs/components/prism-java.js"),
  () => import("prismjs/components/prism-cpp.js"),
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
      // Lexical's code-highlighting path expects Prism to exist on the global
      // object before the Prism language bundles evaluate.
      const prismModule = await import("prismjs");
      const prismInstance = prismModule.default ?? prismModule;
      const prismGlobal = globalThis as PrismGlobal;

      prismGlobal.Prism = prismInstance;

      if (typeof window !== "undefined") {
        (window as Window & { Prism?: unknown }).Prism = prismInstance;
      }

      for (const loadLanguageModule of PRISM_LANGUAGE_LOADERS) {
        await loadLanguageModule();
      }

      prismReady = true;
    } catch (error) {
      // A failed bootstrap must stay retryable. Caching a rejected promise here
      // makes the editor permanently unloadable until a full page refresh.
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
