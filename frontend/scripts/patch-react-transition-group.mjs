import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PACKAGE_JSON_PATH = resolve(process.cwd(), "node_modules/react-transition-group/package.json");

const ROOT_EXPORT = {
  import: "./esm/index.js",
  require: "./cjs/index.js",
  default: "./esm/index.js",
};

const TRANSITION_GROUP_CONTEXT_EXPORT = {
  import: "./esm/TransitionGroupContext.js",
  require: "./cjs/TransitionGroupContext.js",
  default: "./esm/TransitionGroupContext.js",
};

async function patchReactTransitionGroupPackage() {
  let source;

  try {
    source = await readFile(PACKAGE_JSON_PATH, "utf8");
  } catch {
    return;
  }

  const packageJson = JSON.parse(source);
  const exportsField = typeof packageJson.exports === "object" && packageJson.exports !== null ? packageJson.exports : {};

  const nextExports = {
    ...exportsField,
    ".": exportsField["."] ?? ROOT_EXPORT,
    "./TransitionGroupContext": TRANSITION_GROUP_CONTEXT_EXPORT,
  };

  if (JSON.stringify(exportsField) === JSON.stringify(nextExports)) {
    return;
  }

  packageJson.exports = nextExports;
  await writeFile(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`);
}

await patchReactTransitionGroupPackage();
