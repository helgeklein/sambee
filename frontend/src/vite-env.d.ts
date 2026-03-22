/// <reference types="vite/client" />

declare const __SAMBEE_VERSION__: string;
declare const __SAMBEE_GIT_COMMIT__: string;

declare module "*.svg?react" {
  import type React from "react";
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_IMAGE_VIEWER_YARL?: string;
  // Add more env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
