import type { Draft } from "@shared/schema";
import { PLATFORMS } from "@/lib/platforms";
import { publishingBlocker, type ReadinessData } from "@/lib/publishing";

export function PublishingPlatformSelector({ platforms, onChange, draft, readiness, disabled = false }: {
  platforms: string[];
  onChange: (platforms: string[]) => void;
  draft?: Pick<Draft, "content" | "platformPublishRules">;
  readiness: ReadinessData;
  disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-medium">Publish directly to (up to 4)</legend>
    <div className="grid max-h-60 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
      {PLATFORMS.map((platform) => {
        const selected = platforms.includes(platform.value);
        const reason = publishingBlocker(platform.value, draft, readiness);
        return <label key={platform.value} className={`flex min-h-11 items-start gap-2 rounded-md border p-2 text-sm ${selected ? "border-secondary bg-secondary/10" : "border-transparent"}`}>
          <input type="checkbox" className="mt-1 shrink-0" checked={selected}
            disabled={!selected && (!!reason || platforms.length >= 4)}
            onChange={() => onChange(selected ? platforms.filter((value) => value !== platform.value) : platforms.length < 4 && !reason ? [...platforms, platform.value] : platforms)} />
          <span className="min-w-0 break-words">{platform.label}{reason && <span className="mt-1 block text-xs text-muted-foreground">{reason}</span>}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}