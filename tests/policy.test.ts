import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog, presetHiddenSets } from "../src/catalog/catalog";
import {
  buildArgs,
  cleanPolicy,
  exportFiles,
  runtimeEnv,
  toAdminProfile,
  legacyUnsupported,
  operatorEnv,
  toCompose,
  toDockerCommands,
  toServicesFile,
} from "../src/policy/export";
import { importText, parseEnv } from "../src/policy/import";
import {
  CAPABILITIES,
  DEFAULT_OPERATOR_SETTINGS,
  EXPERIENCE_LEVELS,
  SCHEMA_URL,
  SERVICE_KINDS,
  emptyPolicy,
  type AiPolicy,
  type BrandingPolicy,
  type DeploymentPolicy,
  type GeoLensPolicy,
  type InterfacePolicy,
  type PluginsPolicy,
  type ServiceEntry,
  type ServicesPolicy,
  type SharingPolicy,
} from "../src/policy/types";
import { embedOriginProblem, serviceUrlProblem, validatePolicy } from "../src/policy/validate";

const operator = { ...DEFAULT_OPERATOR_SETTINGS };

const full: DeploymentPolicy = {
  version: 1,
  capabilities: ["data:add", "export:data"],
  interface: { enabled: true, level: "beginner", lock: true },
  services: {
    builtins: false,
    catalog: [
      {
        id: "org-wms",
        name: "Internal GeoServer",
        kind: "wms",
        category: "Organization",
        fields: { endpoint: "/geoserver/wms", transparent: true },
      },
    ],
  },
  sharing: {
    shareUrl: "https://projects.example.org",
    collabUrl: "wss://collab.example.org",
    embedOrigins: ["https://portal.example.com"],
  },
  geolens: { url: "same-origin" },
  branding: { appName: "Acme Maps", welcome: false },
  plugins: {
    registryUrl: "/plugins/registry.json",
    allowed: ["acme-tools"],
    blocked: ["bad-plugin"],
    sideload: false,
    defaultActive: ["acme-tools"],
  },
  ai: { enabled: true, model: "openai/gpt-5.6-luna" },
};

type Keys<T> = { [K in keyof Required<T>]: true };
const topKeys: Keys<DeploymentPolicy> = {
  $schema: true,
  version: true,
  capabilities: true,
  interface: true,
  plugins: true,
  services: true,
  sharing: true,
  geolens: true,
  ai: true,
  branding: true,
};
const interfaceKeys: Keys<InterfacePolicy> = {
  enabled: true,
  level: true,
  lock: true,
  hiddenDataSources: true,
  hiddenPlugins: true,
  hiddenMenus: true,
  hiddenMenuItems: true,
};
const pluginsKeys: Keys<PluginsPolicy> = {
  registryUrl: true,
  allowed: true,
  blocked: true,
  sideload: true,
  defaultActive: true,
};
const servicesKeys: Keys<ServicesPolicy> = { builtins: true, catalog: true };
const serviceEntryKeys: Keys<ServiceEntry> = {
  id: true,
  name: true,
  kind: true,
  category: true,
  fields: true,
};
const sharingKeys: Keys<SharingPolicy> = { shareUrl: true, collabUrl: true, embedOrigins: true };
const geolensKeys: Keys<GeoLensPolicy> = { url: true };
const aiKeys: Keys<AiPolicy> = { enabled: true, model: true };
const brandingKeys: Keys<BrandingPolicy> = { appName: true, welcome: true };

describe("schema", () => {
  it("covers every schema key with a typed field", () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, "../schema/deployment.schema.json"), "utf8"));
    const keys = (map: object) => Object.keys(map).sort();
    const props = schema.properties;
    const typed: [string, object, object][] = [
      ["document", schema.properties, topKeys],
      ["interface", props.interface.properties, interfaceKeys],
      ["plugins", props.plugins.properties, pluginsKeys],
      ["services", props.services.properties, servicesKeys],
      ["service entry", props.services.properties.catalog.items.properties, serviceEntryKeys],
      ["sharing", props.sharing.properties, sharingKeys],
      ["geolens", props.geolens.properties, geolensKeys],
      ["ai", props.ai.properties, aiKeys],
      ["branding", props.branding.properties, brandingKeys],
    ];
    for (const [name, fromSchema, fromTypes] of typed) {
      expect({ name, keys: keys(fromSchema) }).toEqual({ name, keys: keys(fromTypes) });
    }
    expect(props.capabilities.items.enum).toEqual([...CAPABILITIES]);
    expect(props.interface.properties.level.enum).toEqual([...EXPERIENCE_LEVELS]);
    expect(props.services.properties.catalog.items.properties.kind.enum).toEqual([...SERVICE_KINDS]);
    expect(schema.$id).toBe(SCHEMA_URL);
  });

  it("accepts an empty and a full policy", () => {
    expect(validatePolicy(emptyPolicy())).toEqual([]);
    expect(validatePolicy(full).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("rejects unknown keys and bad enums", () => {
    const issues = validatePolicy({ version: 1, capabilities: ["data:add", "fly"], extra: true });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["/", "/capabilities/1"]));
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("requires version 1", () => {
    expect(validatePolicy({ version: 2 })[0].path).toBe("/version");
  });
});

describe("semantic validation", () => {
  it("mirrors the container's URL rules", () => {
    expect(serviceUrlProblem("https://a.example", "https", "http")).toBeNull();
    expect(serviceUrlProblem("http://localhost:8000", "https", "http")).toBeNull();
    expect(serviceUrlProblem("http://a.example", "https", "http")).toMatch(/https:\/\//);
    expect(serviceUrlProblem("https://user:pw@a.example", "https", "http")).toMatch(/credentials/);
    expect(serviceUrlProblem("ws://127.0.0.1:1234", "wss", "ws")).toBeNull();
    expect(serviceUrlProblem("not a url", "https", "http")).toMatch(/https/);
  });

  it("checks embed origins", () => {
    expect(embedOriginProblem("https://portal.example.com")).toBeNull();
    expect(embedOriginProblem("*")).toBeNull();
    expect(embedOriginProblem("https://portal.example.com/app")).toMatch(/bare origin/);
    expect(embedOriginProblem("ftp://x.example")).toMatch(/http/);
  });

  it("flags duplicate service ids and bad share URLs", () => {
    const policy: DeploymentPolicy = {
      version: 1,
      services: {
        catalog: [
          { id: "a", name: "A", kind: "xyz", fields: { url: "/t/{z}/{x}/{y}.png" } },
          { id: " a ", name: "B", kind: "xyz", fields: { url: "/u/{z}/{x}/{y}.png" } },
        ],
      },
      sharing: { shareUrl: "http://projects.example.org" },
    };
    const errors = validatePolicy(policy).filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => issue.path)).toEqual(["/services/catalog/1/id", "/sharing/shareUrl"]);
  });

  it("rejects values GeoLibre's parser drops", () => {
    const paths = (policy: DeploymentPolicy) => validatePolicy(policy).map((issue) => issue.path);
    expect(paths({ version: 1, sharing: { shareUrl: "OFF" } })).toContain("/sharing/shareUrl");
    expect(paths({ version: 1, geolens: { url: "geolens.example.org" } })).toContain("/geolens/url");
    expect(validatePolicy({ version: 1, sharing: { shareUrl: "off" }, geolens: { url: "same-origin" } })).toEqual([]);
  });

  it("flags list entries that repeat after trimming", () => {
    const errors = validatePolicy({ version: 1, plugins: { allowed: ["a", " a"] } }).filter(
      (issue) => issue.severity === "error",
    );
    expect(errors.map((issue) => issue.path)).toEqual(["/plugins/allowed/1"]);
  });

  it("warns about plugin precedence and AI settings", () => {
    const warned = (policy: DeploymentPolicy) =>
      validatePolicy(policy).filter((i) => i.severity === "warning").map((i) => i.path);
    expect(
      warned({
        version: 1,
        capabilities: ["data:add"],
        plugins: { allowed: ["x"], blocked: ["x"], defaultActive: ["x", "y"] },
      }),
    ).toEqual(["/plugins/blocked/0", "/plugins/defaultActive/0", "/plugins/defaultActive/1"]);
    expect(warned({ version: 1, plugins: { allowed: [catalog.plugins[0].id] } })).toEqual(["/plugins/allowed/0"]);
    expect(warned({ version: 1, plugins: { allowed: [] } })).toEqual(["/plugins/allowed"]);
    expect(warned({ version: 1, ai: { model: "m" } })).toEqual(["/ai/model"]);
    expect(warned({ version: 1, capabilities: ["data:add"], ai: { enabled: true } })).toEqual(["/ai/enabled"]);
    const errors = (url: string) =>
      validatePolicy({ version: 1, plugins: { registryUrl: url } }).filter((i) => i.severity === "error");
    expect(errors("http://plugins.example.com/r.json").map((i) => i.path)).toEqual(["/plugins/registryUrl"]);
    expect(errors("/plugins/registry.json")).toEqual([]);
    expect(errors("//evil.example.com/r.json").map((i) => i.path)).toEqual(["/plugins/registryUrl"]);
    expect(errors("https://user:pw@plugins.example.com/r.json").map((i) => i.path)).toEqual(["/plugins/registryUrl"]);
    expect(errors("https://plugins.example.com/r.json")).toEqual([]);
    const builtIn = catalog.plugins[0].id;
    expect(warned({ version: 1, plugins: { blocked: [builtIn], defaultActive: [builtIn] } })).toEqual([
      "/plugins/blocked/0",
    ]);
  });

  it("warns about ids missing from the catalog", () => {
    const issues = validatePolicy({ version: 1, interface: { hiddenPlugins: ["some-external-plugin"] } });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });
});

describe("catalog presets", () => {
  it("hides nothing at advanced and more at beginner than intermediate", () => {
    const advanced = presetHiddenSets("advanced");
    expect(Object.values(advanced).every((list) => list.length === 0)).toBe(true);
    const beginner = presetHiddenSets("beginner");
    const intermediate = presetHiddenSets("intermediate");
    expect(beginner.hiddenDataSources.length).toBeGreaterThan(intermediate.hiddenDataSources.length);
    expect(intermediate.hiddenPlugins).toContain("maplibre-gl-geoagent");
    expect(beginner.hiddenPlugins).not.toContain("maplibre-layer-control");
  });

  it("has unique ids", () => {
    for (const list of [catalog.dataSources, catalog.menus, catalog.menuItems, catalog.plugins]) {
      const ids = list.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("export", () => {
  it("drops empty sections but keeps an empty capability list", () => {
    expect(cleanPolicy({ version: 1, sharing: {}, branding: { appName: "" }, capabilities: [] })).toEqual({
      version: 1,
      capabilities: [],
    });
  });

  it("keeps an empty allowed list but drops empty blocked", () => {
    expect(cleanPolicy({ version: 1, plugins: { allowed: [], blocked: undefined } })).toEqual({
      version: 1,
      plugins: { allowed: [] },
    });
  });

  it("produces today's GeoLibre files", () => {
    expect(toAdminProfile(full)).toEqual({ enabled: true, level: "beginner", lock: true });
    expect(toServicesFile(full)?.services[0]).toEqual({
      id: "org-wms",
      name: "Internal GeoServer",
      kind: "wms",
      category: "Organization",
      fields: { endpoint: "/geoserver/wms", transparent: true },
    });
    expect(toAdminProfile(emptyPolicy())).toBeNull();
    expect(toServicesFile(emptyPolicy())).toBeNull();
  });

  it("maps settings to runtime env and build args", () => {
    const env = Object.fromEntries(
      runtimeEnv(full, { sidecar: true, conversionRoots: "/data", postgisHosts: "" }).map((item) => [item.name, item.value]),
    );
    expect(env).toEqual({
      GEOLIBRE_SHARE_URL: "https://projects.example.org",
      GEOLIBRE_COLLAB_URL: "wss://collab.example.org",
      GEOLIBRE_EMBED_ORIGINS: "https://portal.example.com",
      GEOLIBRE_GEOLENS_URL: "same-origin",
      GEOLIBRE_APP_NAME: "Acme Maps",
      GEOLIBRE_SERVICES_FILE: "/config/geolibre-services.json",
      GEOLIBRE_BUILTIN_SERVICES: "off",
      GEOLIBRE_CONVERSION_ROOTS: "/data",
    });
    expect(buildArgs(full)).toEqual([
      { name: "VITE_GEOLIBRE_CAPABILITIES", value: "data:add,export:data" },
      { name: "VITE_WELCOME_DISABLED", value: "1" },
    ]);
    expect(buildArgs({ version: 1, capabilities: [] })).toEqual([{ name: "VITE_GEOLIBRE_CAPABILITIES", value: "none" }]);
    expect(runtimeEnv(emptyPolicy(), { ...operator, sidecar: false })).toEqual([
      { name: "GEOLIBRE_DISABLE_SIDECAR", value: "1", note: undefined },
    ]);
  });

  it("uses the published image when no build args are needed", () => {
    const policy: DeploymentPolicy = { version: 1, branding: { appName: "Acme Maps" } };
    expect(toDockerCommands(policy, operator, "legacy")).not.toContain("docker build");
    expect(toDockerCommands(policy, operator, "legacy")).toContain("-e GEOLIBRE_APP_NAME='Acme Maps'");
    expect(toCompose(policy, operator, "legacy")).toContain("image: ghcr.io/opengeos/geolibre:latest");
    expect(toDockerCommands(full, operator, "legacy")).toContain(
      "--build-arg VITE_GEOLIBRE_CAPABILITIES=data:add,export:data",
    );
    expect(toCompose(full, operator, "legacy")).toContain(
      "./admin-profile.json:/usr/share/nginx/html/admin-profile.json:ro",
    );
  });

  it("lists only the files a legacy policy needs and omits deployment.json", () => {
    expect(exportFiles(emptyPolicy(), operator, "legacy").map((file) => file.name)).toEqual([
      "geolibre.env",
      "docker-run.sh",
      "compose.yaml",
    ]);
    const names = exportFiles(full, operator, "legacy").map((file) => file.name);
    expect(names).toEqual(["admin-profile.json", "geolibre-services.json", "geolibre.env", "docker-run.sh", "compose.yaml"]);
  });

  it("names the settings the legacy target cannot express", () => {
    expect(legacyUnsupported(emptyPolicy())).toEqual([]);
    expect(legacyUnsupported(full)).toHaveLength(3);
    expect(legacyUnsupported({ version: 1, ai: {}, plugins: { allowed: undefined } })).toEqual([]);
    expect(legacyUnsupported({ version: 1, ai: { enabled: false } })).toHaveLength(1);
  });

  it("emits deployment.json with a slim env and mounts it for the runtime target", () => {
    const op = { sidecar: true, conversionRoots: "/data", postgisHosts: "db.internal" };
    const files = exportFiles(full, op, "deployment");
    expect(files.map((file) => file.name)).toEqual(["deployment.json", "geolibre.env", "docker-run.sh", "compose.yaml"]);
    const byName = Object.fromEntries(files.map((file) => [file.name, file.content]));
    expect(JSON.parse(byName["deployment.json"])).toEqual(cleanPolicy(full));
    expect(byName["geolibre.env"]).toContain("GEOLIBRE_CONVERSION_ROOTS=/data");
    expect(byName["geolibre.env"]).toContain("GEOLIBRE_POSTGIS_HOSTS=db.internal");
    expect(byName["geolibre.env"]).not.toMatch(/SHARE_URL|APP_NAME|SERVICES_FILE|BUILTIN/);
    expect(byName["docker-run.sh"]).not.toContain("docker build");
    expect(byName["docker-run.sh"]).not.toContain("--build-arg");
    expect(byName["docker-run.sh"]).toContain('-v "$PWD/deployment.json:/usr/share/nginx/html/deployment.json:ro"');
    expect(byName["docker-run.sh"]).not.toContain("admin-profile");
    expect(byName["compose.yaml"]).toContain("./deployment.json:/usr/share/nginx/html/deployment.json:ro");
    expect(byName["compose.yaml"]).toContain("image: ghcr.io/opengeos/geolibre:latest");
    expect(byName["compose.yaml"]).not.toContain("build:");
    expect(operatorEnv({ ...op, sidecar: false })).toEqual([{ name: "GEOLIBRE_DISABLE_SIDECAR", value: "1" }]);
  });
});

describe("import", () => {
  it("round-trips a deployment.json", () => {
    const text = exportFiles(full, operator, "deployment")[0].content;
    const result = importText(text, emptyPolicy(), operator);
    expect(result.kind).toBe("deployment.json");
    expect(result.policy).toEqual(cleanPolicy(full));
  });

  it("recognizes admin-profile.json and services files", () => {
    const profile = importText('{"level":"intermediate","hiddenPlugins":["x"]}', emptyPolicy(), operator);
    expect(profile.kind).toBe("admin-profile.json");
    expect(profile.policy.interface).toEqual({ level: "intermediate", hiddenPlugins: ["x"] });
    const services = importText(JSON.stringify(toServicesFile(full)), profile.policy, operator);
    expect(services.kind).toBe("services file");
    expect(services.policy.interface).toEqual(profile.policy.interface);
    expect(services.policy.services?.catalog).toHaveLength(1);
  });

  it("imports env files and docker run commands", () => {
    const text = [
      "docker run -d \\",
      "  -e GEOLIBRE_SHARE_URL=off \\",
      "  -e GEOLIBRE_APP_NAME='Acme Maps' \\",
      "  -e GEOLIBRE_DISABLE_SIDECAR=1 \\",
      "  --build-arg VITE_GEOLIBRE_CAPABILITIES=data:add,bogus \\",
      "  ghcr.io/opengeos/geolibre:latest",
    ].join("\n");
    expect(parseEnv(text).get("GEOLIBRE_APP_NAME")).toBe("Acme Maps");
    const result = importText(text, emptyPolicy(), operator);
    expect(result.kind).toBe("environment file");
    expect(result.policy.sharing?.shareUrl).toBe("off");
    expect(result.policy.capabilities).toEqual(["data:add"]);
    expect(result.policy.branding?.appName).toBe("Acme Maps");
    expect(result.operator.sidecar).toBe(false);
  });

  it("normalizes legacy env spellings", () => {
    const legacy = importText(
      "GEOLIBRE_SHARE_URL=OFF\nGEOLIBRE_GEOLENS_URL=geolens.example.org",
      emptyPolicy(),
      operator,
    );
    expect(legacy.policy.sharing?.shareUrl).toBe("off");
    expect(legacy.policy.geolens?.url).toBe("https://geolens.example.org");
    const keyword = importText("GEOLIBRE_GEOLENS_URL=Same-Origin", emptyPolicy(), operator);
    expect(keyword.policy.geolens?.url).toBe("same-origin");
  });

  it("maps AI and registry env without secrets", () => {
    const text = [
      "VITE_GEOLIBRE_PLUGIN_REGISTRY_URL=https://plugins.example.com/r.json",
      "GEOLIBRE_AI_URL=/ai",
      "GEOLIBRE_AI_MODEL=openai/gpt-5.6-luna",
      "GEOLIBRE_AI_PROXY_URL=https://ai.example.com",
      "GEOLIBRE_AI_PROXY_TOKEN=s3cret-token",
    ].join("\n");
    const result = importText(text, emptyPolicy(), operator);
    expect(result.policy.ai).toEqual({ enabled: true, model: "openai/gpt-5.6-luna" });
    expect(result.policy.plugins?.registryUrl).toBe("https://plugins.example.com/r.json");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("s3cret-token");
    expect(serialized).not.toContain("ai.example.com");
  });

  it("rejects documents that fail the schema or aren't recognized", () => {
    expect(() => importText('{"version":1,"interface":{"level":"expert"}}', emptyPolicy(), operator)).toThrow(/schema/);
    expect(() => importText('{"hello":"world"}', emptyPolicy(), operator)).toThrow(/Unrecognized/);
    expect(() => importText("just words", emptyPolicy(), operator)).toThrow(/KEY=VALUE/);
  });
});
