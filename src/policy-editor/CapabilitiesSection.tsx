import { Card, Checkbox, Notice } from "../components/ui";
import { CAPABILITIES, type Capability, type DeploymentPolicy } from "../policy/types";

const DESCRIPTIONS: Record<Capability, string> = {
  "project:edit": "New, Open, Save, Import, Project History, Collaborate, StoryMap, Undo/Redo.",
  "data:add": "The Add Data menu, drag-and-drop, and the embed API's addLayer/addData.",
  "processing:run": "The Processing menu: Whitebox, SQL, Python, AI assistant, geocoding, conversion tools.",
  "export:data": "Share, Export HTML, Print, Print Layout, Offline Basemap, embed exportImage.",
  "plugins:install": "The Plugins menu, activating plugins, and the plugin marketplace.",
  "settings:manage": "The Settings dialog and the Style Manager.",
};

export function CapabilitiesSection({
  policy,
  setPolicy,
}: {
  policy: DeploymentPolicy;
  setPolicy: (update: (policy: DeploymentPolicy) => DeploymentPolicy) => void;
}) {
  const restricted = policy.capabilities !== undefined;
  const granted = new Set(policy.capabilities ?? CAPABILITIES);

  const toggle = (capability: Capability, on: boolean) =>
    setPolicy((current) => {
      const next = new Set(current.capabilities ?? CAPABILITIES);
      if (on) next.add(capability);
      else next.delete(capability);
      return { ...current, capabilities: CAPABILITIES.filter((item) => next.has(item)) };
    });

  return (
    <Card
      title="Capabilities"
      description="Pin what the deployment is allowed to do: a read-only kiosk, a classroom, or the full app."
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Capability mode</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="capability-mode"
              checked={!restricted}
              onChange={() => setPolicy(({ capabilities: _omit, ...rest }) => rest)}
            />
            Grant everything (GeoLibre's default)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="capability-mode"
              checked={restricted}
              onChange={() => setPolicy((current) => ({ ...current, capabilities: [...CAPABILITIES] }))}
            />
            Grant only the capabilities checked below
          </label>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <Checkbox
              key={capability}
              disabled={!restricted}
              checked={granted.has(capability)}
              onChange={(on) => toggle(capability, on)}
              label={<code className="font-mono text-xs">{capability}</code>}
              description={DESCRIPTIONS[capability]}
            />
          ))}
        </div>
        <Notice tone="warning">
          Capabilities remove menus and commands in the browser. They don't restrict the server: the
          sidecar and AI proxy still answer requests, so pair them with the server settings. In releases up
          to v3.2.0 GeoLibre reads them at <strong>build time</strong> only (
          <code>VITE_GEOLIBRE_CAPABILITIES</code>), so a restricted set means building your own image. With a
          runtime <code>deployment.json</code> they are read when the app starts, but they fail open: a file
          that is missing, blocked or slower than 3 seconds leaves the session with the full grant, so this
          is not enforcement (see GeoLibre's docs/deployment-policy.md).
        </Notice>
      </div>
    </Card>
  );
}
