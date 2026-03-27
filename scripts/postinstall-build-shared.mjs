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

if (workspaceFilteredInstall && !targetsSharedWorkspace) {
  console.log(
    `[postinstall] skipping @synteq/shared build for workspace-filtered install: ${workspaceSelection.join(", ")}`
  );
  process.exit(0);
}

const sharedRequire = createRequire(new URL("../packages/shared/package.json", import.meta.url));

try {
  sharedRequire.resolve("zod");
} catch {
  throw new Error("Missing required dependency 'zod' for @synteq/shared build during postinstall.");
}

execSync("npm run build --workspace @synteq/shared", {
  stdio: "inherit"
});
