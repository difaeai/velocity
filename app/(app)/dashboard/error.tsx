'use client';

/**
 * A console page that throws while drawing stops here, inside the console:
 * the sidebar stays and the error says what broke. Without it the whole app
 * fell to Next's black "This page couldn't load" — which is how a missing
 * dailyCap on the first ads connect took Manage social down on 26 Oct.
 *
 * The crash also goes to the Testing log (feature `console.page`) through the
 * same callable the phone's watcher uses, so it is seen even when nobody says.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { qaApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const pathname = usePathname();

  useEffect(() => {
    console.error(error);
    // Never throws: a report that fails must not hide the page's own error.
    qaApi
      .report({
        reports: [
          {
            featureId: 'console.page',
            kind: 'threw',
            whatHappened: `${pathname} threw while drawing: ${error.message}`.slice(0, 400),
            errorMessage: error.message.slice(0, 400),
            screen: pathname.slice(0, 80),
            detail: { stack: (error.stack ?? '').split('\n').slice(0, 4).join(' | ').slice(0, 200), digest: error.digest ?? '' },
          },
        ],
        platform: 'web',
      })
      .catch(() => undefined);
  }, [error, pathname]);

  return (
    <Card style={{ maxWidth: 620, margin: '40px auto', display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 17 }}>This page hit an error</strong>
      <span style={{ color: colors.muted, fontSize: 14, lineHeight: 1.6 }}>
        The rest of the console still works. It has been sent to Testing so it gets fixed.
      </span>
      <code style={{ fontSize: 12.5, color: colors.danger, whiteSpace: 'pre-wrap' }}>{error.message}</code>
      <div>
        <Button onClick={() => retry()}>Try again</Button>
      </div>
    </Card>
  );
}
