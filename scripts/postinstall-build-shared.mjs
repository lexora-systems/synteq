import { execSync } from "node:child_process";
import { createRequire } from "node:module";

function parseWorkspaceSelection(raw) {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      // fall through to string split
    }
  }

  return trimmed
    .split(/[\s,]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

const workspaceSelection = parseWorkspaceSelection(process.env.npm_config_workspace);
const workspaceFilteredInstall = workspaceSelection.length > 0;
const targetsSharedWorkspace = workspaceSelection.some((value) =>
  value === "@synteq/shared" ||
  value === "packages/shared" ||
  value.endsWith("/packages/shared")
);

function skipSharedBuild(reason) {
  console.warn(`[postinstall] warning: ${reason}`);
  console.warn("[postinstall] skipping @synteq/shared build");
  process.exit(0);
}

if (workspaceFilteredInstall && !targetsSharedWorkspace) {
  skipSharedBuild(`workspace-filtered install excludes shared workspace (${workspaceSelection.join(", ")})`);
}

const sharedRequire = createRequire(new URL("../packages/shared/package.json", import.meta.url));

try {
  sharedRequire.resolve("zod");
} catch {
  skipSharedBuild("missing required dependency 'zod' for @synteq/shared in current install context");
}

try {
  sharedRequire.resolve("typescript");
} catch {
  skipSharedBuild("missing build dependency 'typescript' for @synteq/shared in current install context");
}

execSync("npm run build --workspace @synteq/shared", {
  stdio: "inherit"
});
