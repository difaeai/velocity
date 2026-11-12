'use client';

import { useState } from 'react';

import { BrainDemo } from './BrainDemo';

/**
 * Opens the demo — the one way in, from the header and from the price card.
 *
 * The dialog itself is heavy (slides, art, the brain's routing), so it is
 * mounted on the first press and not before.
 */
export function DemoButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? <BrainDemo onClose={() => setOpen(false)} /> : null}
    </>
  );
}
