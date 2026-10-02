import { useState } from "react";
import { Button, Card, CopyButton, Notice, cx, downloadText } from "../components/ui";
import { EXPORT_TARGETS, buildArgs, exportFiles, legacyUnsupported, type ExportTarget } from "../policy/export";
import type { DeploymentPolicy, OperatorSettings } from "../policy/types";
import type { Issue } from "../policy/validate";

export function ExportSection({
  policy,
  operator,
  issues,
}: {
  policy: DeploymentPolicy;
  operator: OperatorSettings;
  issues: Issue[];
}) {
  const [target, setTarget] = useState<ExportTarget>("legacy");
  const files = exportFiles(policy, operator, target);
  const [selected, setSelected] = useState("");
  const file = files.find((item) => item.name === selected) ?? files[0];
  const errors = issues.filter((issue) => issue.severity === "error");
  const needsBuild = target === "legacy" && buildArgs(policy).length > 0;
  const lost = target === "legacy" ? legacyUnsupported(policy) : [];
  const current = EXPORT_TARGETS.find((item) => item.value === target)!;

  return (
    <Card
      title="Review and export"
      description="Download the files for your deployment. Nothing leaves this browser."
      actions={
        <Button
          variant="primary"
          disabled={errors.length > 0}
          onClick={() => files.forEach((item) => downloadText(item.name, item.content))}
        >
          Download all
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Export for</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPORT_TARGETS.map((option) => (
              <label
                key={option.value}
                className={cx(
                  "flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2",
                  target === option.value ? "border-accent bg-accent-soft" : "border-border",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="export-target"
                    checked={target === option.value}
                    onChange={() => {
                      setTarget(option.value);
                      setSelected("");
                    }}
                  />
                  {option.label}
                </span>
                <span className="text-xs text-muted">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {lost.length ? (
          <Notice tone="warning">
            {current.label} can't express these settings, so they are left out of the files below:
            <ul className="mt-1 list-disc ps-5">
              {lost.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            Switch to the runtime deployment.json target to deploy them.
          </Notice>
        ) : null}
        {errors.length ? (
          <Notice tone="danger">Fix {errors.length === 1 ? "the error" : `the ${errors.length} errors`} above before exporting.</Notice>
        ) : null}
        {needsBuild ? (
          <Notice tone="warning">
            This policy uses build-time settings, so it needs a custom image built from a GeoLibre checkout. The
            other settings work with the published image.
          </Notice>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1" aria-label="Generated files">
            {files.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  aria-current={item.name === file.name}
                  onClick={() => setSelected(item.name)}
                  className={cx(
                    "w-full rounded-md px-3 py-2 text-start",
                    item.name === file.name ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className="block font-mono text-sm">{item.name}</span>
                  <span className="block text-xs text-muted">{item.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="font-mono text-sm">{file.name}</span>
              <span className="flex gap-1.5">
                <CopyButton text={file.content} />
                <Button size="sm" onClick={() => downloadText(file.name, file.content)} disabled={errors.length > 0}>
                  Download
                </Button>
              </span>
            </div>
            <pre className="max-h-[32rem] overflow-auto p-3 font-mono text-xs leading-relaxed" data-testid="export-preview">
              {file.content}
            </pre>
          </div>
        </div>
        <p className="text-xs text-muted">
          {target === "deployment" ? (
            <>
              GeoLibre fetches <code>deployment.json</code> from the app root before the first render and ignores it
              when it is missing, late (3 s) or blocked, so the settings fail open. Generating the file from an
              environment variable (<code>GEOLIBRE_DEPLOYMENT_FILE</code>) is not shipped yet, so the commands mount it
              directly. Capabilities and plugin allow or block lists are client-side hiding, not server enforcement.
            </>
          ) : (
            <>
              Released GeoLibre versions don't read <code>deployment.json</code>, so this target omits it. Re-export for
              the runtime target once you run a build that includes it.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}
