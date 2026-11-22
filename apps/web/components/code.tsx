"use client";

import { useState } from "react";

export function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {label && <div className="mb-1 text-xs text-muted">{label}</div>}
      <pre className="overflow-x-auto rounded-md border border-line bg-black/30 p-3 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
      <button
        type="button"
        className="absolute right-2 top-6 rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:text-fg"
        onClick={async () => {
          await navigator.clipboard?.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
