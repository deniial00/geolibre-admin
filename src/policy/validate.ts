import { catalog } from "../catalog/catalog";
import validateSchema from "./schema-validator.generated.js";
import type { DeploymentPolicy, InterfacePolicy, OperatorSettings } from "./types";

export interface Issue {
  severity: "error" | "warning";
  /** JSON pointer into the policy, or `operator/<field>` for env-only settings. */
  path: string;
  message: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOST_CHARS = /^[A-Za-z0-9.\-:[\]]+$/;

/**
 * Check a service URL the way GeoLibre's container entrypoint does: no
 * embedded credentials, a plain host, and a TLS scheme except on loopback.
 *
 * @param value - The URL to check.
 * @param secure - The required scheme, e.g. `https`.
 * @param plain - The scheme allowed on loopback hosts, e.g. `http`.
 * @returns An error message, or null when the URL is acceptable.
 */
export function serviceUrlProblem(value: string, secure: string, plain: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `must be a ${secure}:// URL`;
  }
  if (url.username || url.password) return "must not embed credentials";
  if (!HOST_CHARS.test(url.host)) return "has an invalid host";
  const scheme = url.protocol.slice(0, -1);
  if (scheme === plain && LOOPBACK.has(url.hostname)) return null;
  if (scheme !== secure) {
    return `must be a ${secure}:// URL (or ${plain}:// on localhost/127.0.0.1)`;
  }
  return null;
}

/**
 * Check that an embed origin is a bare http(s) origin, or `*`.
 *
 * @param value - The origin to check.
 * @returns An error message, or null when the origin is acceptable.
 */
export function embedOriginProblem(value: string): string | null {
  if (value === "*") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "must be an http(s) origin";
    if (url.username || url.password) return "must not embed credentials";
    if (url.origin !== value.replace(/\/$/, "")) {
      return `must be a bare origin such as ${url.origin}`;
    }
    return null;
  } catch {
    return "must be an http(s) origin such as https://portal.example.com";
  }
}

function unknownIds(
  issues: Issue[],
  profile: InterfacePolicy,
  key: keyof InterfacePolicy,
  known: { id: string }[],
  what: string,
) {
  const ids = profile[key];
  if (!Array.isArray(ids)) return;
  const set = new Set(known.map((item) => item.id));
  for (const id of ids) {
    if (!set.has(id)) {
      issues.push({
        severity: "warning",
        path: `/interface/${key}`,
        message: `"${id}" is not a ${what} id in GeoLibre ${catalog.source.commit}; it is ignored unless a newer build or an external plugin defines it.`,
      });
    }
  }
}

const BUILT_IN_PLUGINS = new Set(catalog.plugins.map((plugin) => plugin.id));

function pluginIssues(issues: Issue[], doc: DeploymentPolicy) {
  const plugins = doc.plugins;
  if (!plugins) return;
  const registry = plugins.registryUrl?.trim();
  if (registry && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(registry)) {
    const problem = serviceUrlProblem(registry, "https", "http");
    if (problem) {
      issues.push({ severity: "error", path: "/plugins/registryUrl", message: `Registry URL ${problem}.` });
    }
  }
  if (plugins.allowed?.length === 0) {
    issues.push({ severity: "warning", path: "/plugins/allowed", message: "No external plugins may load." });
  }
  const allowed = plugins.allowed;
  const blocked = plugins.blocked ?? [];
  for (const list of ["allowed", "blocked"] as const) {
    plugins[list]?.forEach((id, index) => {
      if (BUILT_IN_PLUGINS.has(id)) {
        issues.push({
          severity: "warning",
          path: `/plugins/${list}/${index}`,
          message: `"${id}" is a built-in plugin; allowed and blocked only govern external plugins. Hide it under Interface instead.`,
        });
      }
    });
  }
  blocked.forEach((id, index) => {
    if (allowed?.includes(id)) {
      issues.push({
        severity: "warning",
        path: `/plugins/blocked/${index}`,
        message: `"${id}" is both allowed and blocked; blocked wins, so it never loads.`,
      });
    }
  });
  plugins.defaultActive?.forEach((id, index) => {
    const path = `/plugins/defaultActive/${index}`;
    if (blocked.includes(id)) {
      issues.push({ severity: "warning", path, message: `"${id}" is blocked, so it can't start active.` });
    } else if (allowed && !BUILT_IN_PLUGINS.has(id) && !allowed.includes(id)) {
      issues.push({ severity: "warning", path, message: `"${id}" is not in the allowed list, so it can't start active.` });
    }
  });
}

function aiIssues(issues: Issue[], doc: DeploymentPolicy) {
  const ai = doc.ai;
  if (!ai) return;
  if (ai.model && ai.enabled !== true) {
    issues.push({
      severity: "warning",
      path: "/ai/model",
      message: "The model has no effect while the assistant is disabled.",
    });
  }
  if (ai.enabled === true && doc.capabilities && !doc.capabilities.includes("processing:run")) {
    issues.push({
      severity: "warning",
      path: "/ai/enabled",
      message: "The assistant is enabled but processing:run is not granted, which hides it in the app.",
    });
  }
}

/**
 * Check a document against the deployment JSON Schema only.
 *
 * @param policy - The candidate document.
 * @returns One error per schema violation; empty when it conforms.
 */
export function schemaIssues(policy: unknown): Issue[] {
  if (validateSchema(policy)) return [];
  return (validateSchema.errors ?? []).map((error) => {
    const detail =
      error.keyword === "additionalProperties"
        ? `has unknown property "${(error.params as { additionalProperty: string }).additionalProperty}"`
        : error.keyword === "enum"
          ? `must be one of ${(error.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`
          : (error.message ?? "is invalid");
    return { severity: "error" as const, path: error.instancePath || "/", message: detail };
  });
}

/**
 * Validate a policy against the JSON Schema and the rules GeoLibre's
 * container applies at startup.
 *
 * @param policy - The policy document (possibly malformed).
 * @param operator - Env-only settings to check alongside it.
 * @returns Every issue found; empty when the policy is valid.
 */
export function validatePolicy(policy: unknown, operator?: OperatorSettings): Issue[] {
  const issues = schemaIssues(policy);
  if (issues.length) return issues;
  const doc = policy as DeploymentPolicy;

  // The schema can't express "unique after trimming", but GeoLibre's parser
  // drops the whole section when a list has such a duplicate.
  const lists: [string, string[] | undefined][] = [
    ["/interface/hiddenDataSources", doc.interface?.hiddenDataSources],
    ["/interface/hiddenPlugins", doc.interface?.hiddenPlugins],
    ["/interface/hiddenMenus", doc.interface?.hiddenMenus],
    ["/interface/hiddenMenuItems", doc.interface?.hiddenMenuItems],
    ["/plugins/allowed", doc.plugins?.allowed],
    ["/plugins/blocked", doc.plugins?.blocked],
    ["/plugins/defaultActive", doc.plugins?.defaultActive],
    ["/sharing/embedOrigins", doc.sharing?.embedOrigins],
  ];
  for (const [path, list] of lists) {
    const seenItems = new Set<string>();
    list?.forEach((item, index) => {
      const id = item.trim();
      if (seenItems.has(id)) {
        issues.push({
          severity: "error",
          path: `${path}/${index}`,
          message: `Duplicate entry "${id}"; GeoLibre ignores the whole section when a list repeats an entry.`,
        });
      }
      seenItems.add(id);
    });
  }

  const profile = doc.interface;
  if (profile) {
    unknownIds(issues, profile, "hiddenDataSources", catalog.dataSources, "data source");
    unknownIds(issues, profile, "hiddenPlugins", catalog.plugins, "built-in plugin");
    unknownIds(issues, profile, "hiddenMenus", catalog.menus, "menu");
    unknownIds(issues, profile, "hiddenMenuItems", catalog.menuItems, "menu item");
    if (profile.enabled === false && (profile.level || profile.lock)) {
      issues.push({
        severity: "warning",
        path: "/interface/enabled",
        message: "Filtering is disabled, so the level and lock have no effect.",
      });
    }
  }

  pluginIssues(issues, doc);
  aiIssues(issues, doc);

  const services = doc.services?.catalog ?? [];
  const seen = new Set<string>();
  services.forEach((service, index) => {
    const id = service.id.trim();
    if (seen.has(id)) {
      issues.push({
        severity: "error",
        path: `/services/catalog/${index}/id`,
        message: `Duplicate service id "${id}"; every service needs a unique stable id.`,
      });
    }
    seen.add(id);
    for (const [key, value] of Object.entries(service.fields)) {
      if (typeof value === "number" && !Number.isSafeInteger(value) && Number.isInteger(value)) {
        issues.push({
          severity: "error",
          path: `/services/catalog/${index}/fields/${key}`,
          message: "Integers must be within the safe-integer range.",
        });
      }
    }
  });
  if (doc.services?.builtins === false && services.length === 0) {
    issues.push({
      severity: "warning",
      path: "/services/builtins",
      message: "Built-in services are hidden and the catalog is empty, so users see only their own entries.",
    });
  }

  const share = doc.sharing?.shareUrl?.trim();
  if (share && share !== "off") {
    const problem = serviceUrlProblem(share, "https", "http");
    if (problem) issues.push({ severity: "error", path: "/sharing/shareUrl", message: `Share URL ${problem}.` });
  }
  const collab = doc.sharing?.collabUrl?.trim();
  if (collab) {
    const problem = serviceUrlProblem(collab, "wss", "ws");
    if (problem) issues.push({ severity: "error", path: "/sharing/collabUrl", message: `Collaboration URL ${problem}.` });
  }
  doc.sharing?.embedOrigins?.forEach((origin, index) => {
    const problem = embedOriginProblem(origin);
    if (problem) issues.push({ severity: "error", path: `/sharing/embedOrigins/${index}`, message: `"${origin}" ${problem}.` });
    if (origin === "*") {
      issues.push({
        severity: "warning",
        path: `/sharing/embedOrigins/${index}`,
        message: "\"*\" lets any page that frames the app drive it. Use it on private networks only.",
      });
    }
  });

  const geolens = doc.geolens?.url?.trim();
  if (geolens && geolens !== "off" && geolens !== "same-origin") {
    const problem = /[?#]/.test(geolens)
      ? "must not include query parameters or a fragment"
      : serviceUrlProblem(geolens, "https", "http");
    if (problem) issues.push({ severity: "error", path: "/geolens/url", message: `GeoLens URL ${problem}.` });
  }

  if (doc.capabilities && doc.capabilities.length === 0) {
    issues.push({
      severity: "warning",
      path: "/capabilities",
      message: "No capabilities are granted: the app is a read-only viewer.",
    });
  }

  if (operator?.postgisHosts.trim() && !operator.sidecar) {
    issues.push({
      severity: "warning",
      path: "operator/postgisHosts",
      message: "PostGIS hosts have no effect while the sidecar is disabled.",
    });
  }

  return issues;
}
