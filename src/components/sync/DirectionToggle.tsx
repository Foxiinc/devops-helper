interface DirectionToggleProps {
  direction: "push" | "pull";
  localPath: string;
  remotePath: string;
  onChange: (direction: "push" | "pull") => void;
}

function shortPath(path: string, max = 28): string {
  if (path.length <= max) return path;
  return `…${path.slice(-max + 1)}`;
}

export function DirectionToggle({
  direction,
  localPath,
  remotePath,
  onChange,
}: DirectionToggleProps) {
  const isPush = direction === "push";

  return (
    <div className="bb-card flex flex-wrap items-center justify-center gap-3 rounded-xl p-4">
      <div className="min-w-0 text-center">
        <p className="bb-muted text-[10px] uppercase tracking-wide">Local</p>
        <p className="bb-text mt-0.5 truncate font-mono text-xs" title={localPath}>
          {shortPath(localPath)}
        </p>
      </div>

      <button
        type="button"
        className="btn-secondary px-4 py-2 font-mono text-sm"
        onClick={() => onChange(isPush ? "pull" : "push")}
        title={isPush ? "Switch to pull (remote → local)" : "Switch to push (local → remote)"}
      >
        {isPush ? "── ➔ ──" : "── ◄ ──"}
      </button>

      <div className="min-w-0 text-center">
        <p className="bb-muted text-[10px] uppercase tracking-wide">Remote</p>
        <p className="bb-text mt-0.5 truncate font-mono text-xs" title={remotePath}>
          {shortPath(remotePath)}
        </p>
      </div>

      <p className="bb-muted w-full text-center text-xs">
        {isPush ? "Push — upload changes to server" : "Pull — download changes from server"}
      </p>
    </div>
  );
}
