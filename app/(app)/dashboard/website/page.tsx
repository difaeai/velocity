'use client';

/**
 * Website — which front page velocityrides.app opens as.
 *
 * This is the only writer of `adminConfig/site`. The front page reads it on
 * the server (lib/siteTemplate.ts) as the hosting backend's own service
 * account, so the choice needs no deploy and nothing in it is readable from a
 * browser. It is re-read every half minute, which is how long a save takes to
 * show up for visitors.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';
import { SkeletonRows } from '@/components/states';
import {
  DEFAULT_SITE_TEMPLATE,
  SITE_TEMPLATES,
  SITE_TEMPLATE_DOC,
  SITE_TEMPLATE_INFO,
  isSiteTemplate,
  type SiteTemplate,
} from '@/lib/siteTemplate';

/** What each choice looks like, drawn rather than described. */
function Thumb({ template }: { template: SiteTemplate }) {
  const box: React.CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    background: '#04120c',
    overflow: 'hidden',
    position: 'relative',
  };
  const bar: React.CSSProperties = { height: 7, background: '#0b271c', borderBottom: '1px solid #15301f' };
  const body: React.CSSProperties = { padding: 5, display: 'grid', gap: 3 };
  const line = (w: string, lime = false): React.CSSProperties => ({
    height: 4,
    width: w,
    borderRadius: 2,
    background: lime ? '#ccff00' : '#2c4a39',
  });

  if (template === 'split') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, height: 74 }}>
        {[0, 1].map((i) => (
          <div key={i} style={box}>
            <div style={bar} />
            <div style={body}>
              <div style={line('80%')} />
              <div style={line('55%', i === 1)} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (template === 'mix') {
    return (
      <div style={{ ...box, height: 74 }}>
        <div style={bar} />
        <div style={{ padding: 5, display: 'grid', gap: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
            <div style={{ height: 20, borderRadius: 3, background: '#123524' }} />
            <div style={{ height: 20, borderRadius: 3, background: '#1d2f1a' }} />
          </div>
          <div style={line('70%', true)} />
          <div style={line('85%')} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...box, height: 74 }}>
      <div style={bar} />
      <div style={body}>
        <div style={line('70%', template === 'vexa')} />
        <div style={line('88%')} />
        <div style={line('45%')} />
      </div>
    </div>
  );
}

export default function WebsitePage() {
  const [live, setLive] = useState<SiteTemplate | null>(null);
  const [chosen, setChosen] = useState<SiteTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () =>
      onSnapshot(
        doc(db, SITE_TEMPLATE_DOC.collection, SITE_TEMPLATE_DOC.id),
        (snap) => {
          const t = snap.data()?.template;
          const current = isSiteTemplate(t) ? t : DEFAULT_SITE_TEMPLATE;
          setLive(current);
          // Only before the first pick, so a save elsewhere never moves what is being chosen here.
          setChosen((c) => c ?? current);
        },
        (e) => setError(e.message),
      ),
    [],
  );

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError('');
    try {
      await setDoc(
        doc(db, SITE_TEMPLATE_DOC.collection, SITE_TEMPLATE_DOC.id),
        { template: chosen, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Website</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 720, lineHeight: 1.6 }}>
        What someone sees when they open <strong>velocityrides.app</strong>. Whichever you choose becomes the website
        itself — not a page inside it — and it stays that way until you change it here. Velocity Rides is always at{' '}
        <strong>/rides</strong> and Vexa at <strong>/vexa</strong>, whatever is chosen.
      </p>

      {error && (
        <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14, maxWidth: 720 }}>{error}</div>
      )}
      {saved && (
        <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>
          ✓ Saved — visitors see it within about half a minute
        </div>
      )}

      {live === null ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
            {SITE_TEMPLATES.map((t) => {
              const picked = chosen === t;
              return (
                <Card key={t} style={{ padding: 0, border: `2px solid ${picked ? colors.primary : colors.border}` }}>
                  <label
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '22px 150px 1fr',
                      gap: 14,
                      alignItems: 'start',
                      padding: 16,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="template"
                      checked={picked}
                      onChange={() => setChosen(t)}
                      style={{ width: 18, height: 18, accentColor: colors.primary, marginTop: 2 }}
                    />
                    <Thumb template={t} />
                    <div>
                      <div style={{ fontSize: 15.5, fontWeight: 900, color: colors.text }}>
                        {SITE_TEMPLATE_INFO[t].name}
                        {live === t && (
                          <span style={{ color: colors.success, fontSize: 12, fontWeight: 800, marginLeft: 8 }}>
                            ● live now
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 1.55 }}>
                        {SITE_TEMPLATE_INFO[t].what}
                      </div>
                    </div>
                  </label>
                </Card>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
            <Button onClick={save} disabled={saving || !chosen || chosen === live}>
              {saving ? 'Saving…' : chosen === live ? 'Already live' : 'Save'}
            </Button>
            <a href="/" target="_blank" rel="noreferrer" style={{ fontSize: 13.5, color: colors.primary }}>
              Open the website ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}
