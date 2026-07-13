import type { SyncPreview } from "../../types";
import { formatSyncBytes, previewItemIcon, previewItemLabel, previewSummary } from "./syncUtils";

interface SyncPreviewListProps {
  preview: SyncPreview | null;
  loading?: boolean;
  maxHeightClass?: string;
}

export function SyncPreviewList({
  preview,
  loading = false,
  maxHeightClass = "max-h-72",
}: SyncPreviewListProps) {
  if (loading) {
    return (
      <div className="bb-muted bb-card rounded-lg p-6 text-center text-sm">
        Scanning files…
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="bb-muted bb-card rounded-lg p-6 text-center text-sm">
        Run analysis to see what will change
      </div>
    );
  }

  return (
    <div className="bb-card overflow-hidden rounded-lg">
      <div className="bb-border bb-muted border-b px-4 py-2 text-xs">
        {previewSummary(preview)}
      </div>
      {preview.items.length === 0 ? (
        <p className="bb-muted px-4 py-6 text-center text-sm">Already in sync — nothing to transfer</p>
      ) : (
        <div className={`${maxHeightClass} overflow-y-auto`}>
          {preview.items.map((item, i) => (
            <div
              key={`${item.path}-${i}`}
              className="bb-border bb-text flex items-center gap-2 border-b px-4 py-2 font-mono text-xs last:border-b-0"
            >
              <span className="shrink-0">{previewItemIcon(item)}</span>
              <span className="bb-accent shrink-0 uppercase">{previewItemLabel(item)}</span>
              <span className="min-w-0 flex-1 truncate" title={item.path}>
                {item.path}
              </span>
              {(item.size_bytes ?? 0) > 0 && (
                <span className="bb-muted shrink-0">{formatSyncBytes(item.size_bytes ?? 0)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
