import { useState } from 'react';

/** A read-only link box with a Copy link button (Models… rows). */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="model-link">
      <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy link'}</button>
    </span>
  );
}
