import { Card, Checkbox, Field, Input, Notice } from "../components/ui";
import type { AiPolicy, DeploymentPolicy } from "../policy/types";
import type { Issue } from "../policy/validate";
import { issueAt, type SetPolicy } from "./SharingSection";

export function AiSection({
  policy,
  setPolicy,
  issues,
}: {
  policy: DeploymentPolicy;
  setPolicy: SetPolicy;
  issues: Issue[];
}) {
  const setAi = (patch: Partial<AiPolicy>) =>
    setPolicy((current) => ({ ...current, ai: { ...current.ai, ...patch } }));

  return (
    <Card
      title="AI assistant"
      description="Whether the app offers the assistant and which model it uses (deployment.json ai)."
    >
      <div className="flex flex-col gap-5">
        <Checkbox
          checked={policy.ai?.enabled === true}
          onChange={(on) => setAi({ enabled: on ? true : undefined })}
          label="Enable the AI assistant"
          description="Exposes the same-origin /ai route. The server also needs the proxy variables below."
        />
        <Field
          label="Model"
          hint="Empty keeps the image default (openai/gpt-5.6-luna)."
          error={issueAt(issues, "/ai/model")}
        >
          {(id) => (
            <Input
              id={id}
              value={policy.ai?.model ?? ""}
              placeholder="openai/gpt-5.6-luna"
              onChange={(event) => setAi({ model: event.target.value || undefined })}
            />
          )}
        </Field>
        <Notice tone="warning">
          The proxy URL and token (GEOLIBRE_AI_PROXY_URL, GEOLIBRE_AI_PROXY_TOKEN) stay in the server
          environment and are never written to deployment.json. This tool never asks for them.
        </Notice>
      </div>
    </Card>
  );
}
