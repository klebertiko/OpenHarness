"use client";

import { useState } from "react";

export function MessageActions({ content, onReuse }: { content: string; onReuse?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setError(false);
    } catch {
      setCopied(false);
      setError(true);
    }
  };
  const buttonClass = "rounded-control px-1.5 py-1 text-[11px] text-ink-faint hover:bg-sub-200 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal";
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={() => void copy()} className={buttonClass}>Copy message</button>
    {onReuse && <button type="button" onClick={onReuse} className={buttonClass}>Reuse message</button>}
    {copied && <span role="status" className="text-[11px] text-ink-mute">Copied</span>}
    {error && <span role="alert" className="text-[11px] text-warn">Could not copy. Select the message text and copy it manually.</span>}
  </div>;
}
