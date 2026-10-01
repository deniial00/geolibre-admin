/**
 * The deployment policy document (`deployment.json`, version 1). It mirrors
 * GeoLibre's `schema/deployment.schema.json`; these types are hand-written to
 * match, and a test fails when a schema key has no field here.
 *
 * Everything in it is published to every visitor of the deployment, so it
 * holds only client-facing settings. Secrets and infrastructure settings
 * (proxy tokens, conversion roots, PostGIS hosts) live in {@link OperatorSettings},
 * which is exported as environment variables only.
 */

export const CAPABILITIES = [
  "project:edit",
  "data:add",
  "processing:run",
  "export:data",
  "plugins:install",
  "settings:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const SERVICE_KINDS = ["wms", "wfs", "wmts", "xyz", "arcgis", "csw"] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** The `admin-profile.json` settings GeoLibre reads today. */
export interface InterfacePolicy {
  enabled?: boolean;
  level?: ExperienceLevel;
  lock?: boolean;
  hiddenDataSources?: string[];
  hiddenPlugins?: string[];
  hiddenMenus?: string[];
  hiddenMenuItems?: string[];
}

export interface PluginsPolicy {
  /** Marketplace registry URL, absolute or relative to the app. */
  registryUrl?: string;
  /** External plugin ids allowed to load. Omitted allows any; `[]` allows none. */
  allowed?: string[];
  /** External plugin ids never loaded, even when also allowed. */
  blocked?: string[];
  /** `false` removes installing from a manifest URL, zip, directory or project file. */
  sideload?: boolean;
  /** Plugin ids active in a fresh project. */
  defaultActive?: string[];
}

/** One entry of the curated service library (`GEOLIBRE_SERVICES_FILE`). */
export interface ServiceEntry {
  id: string;
  name: string;
  kind: ServiceKind;
  category?: string;
  fields: Record<string, string | number | boolean>;
}

export interface ServicesPolicy {
  /** `false` hides GeoLibre's built-in starter services. */
  builtins?: boolean;
  catalog?: ServiceEntry[];
}

export interface SharingPolicy {
  /** A projects server URL, or `"off"` to remove Share and the Gallery. */
  shareUrl?: string;
  /** A `wss://` live-collaboration relay. */
  collabUrl?: string;
  /** Origins allowed to drive a framed app over the embed API. */
  embedOrigins?: string[];
}

export interface GeoLensPolicy {
  /** A GeoLens server root, `"same-origin"`, or `"off"`. */
  url?: string;
}

export interface AiPolicy {
  /** Expose the same-origin `/ai` assistant route (default false). */
  enabled?: boolean;
  /** Default assistant model id. */
  model?: string;
}

export interface BrandingPolicy {
  appName?: string;
  /** `false` skips the first-launch welcome wizard (a build-time setting). */
  welcome?: boolean;
}

export interface DeploymentPolicy {
  $schema?: string;
  version: 1;
  /** Omitted grants every capability; an empty list grants none. */
  capabilities?: Capability[];
  interface?: InterfacePolicy;
  plugins?: PluginsPolicy;
  services?: ServicesPolicy;
  sharing?: SharingPolicy;
  geolens?: GeoLensPolicy;
  ai?: AiPolicy;
  branding?: BrandingPolicy;
}

/** Server-side settings that never belong in the published policy document. */
export interface OperatorSettings {
  sidecar: boolean;
  conversionRoots: string;
  postgisHosts: string;
}

export const DEFAULT_OPERATOR_SETTINGS: OperatorSettings = {
  sidecar: true,
  conversionRoots: "",
  postgisHosts: "",
};

export const SCHEMA_URL =
  "https://raw.githubusercontent.com/opengeos/GeoLibre/main/schema/deployment.schema.json";

/**
 * Create an empty policy, which leaves every GeoLibre default in place.
 *
 * @returns A version 1 policy with no settings.
 */
export function emptyPolicy(): DeploymentPolicy {
  return { $schema: SCHEMA_URL, version: 1 };
}
