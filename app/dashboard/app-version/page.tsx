'use client';

/**
 * Publishes the version that is live on the Play Store.
 *
 * This is the only writer of `config/appVersion`, the doc every installed app
 * compares itself against on launch (see apps/mobile/src/lib/appUpdate.ts). The
 * rule the app enforces on its side is worth restating here, because it is what
 * makes this page safe to leave switched on: an install only prompts when the
 * published version is strictly NEWER than the one it is running. Publishing
 * 1.1.0 while everyone is already on 1.1.0 prompts nobody.
 *
 * Which means the release ritual is: push the build to Play, wait for the
 * rollout, then set the number here. Setting it early would ask people to fetch
 * an update the store cannot serve them yet.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';

interface VersionForm {
  enabled: boolean;
  latestVersion: string;
  latestBuild: string;
  minSupportedVersion: string;
  releaseNotes: string;
  storeUrl: string;
}

const EMPTY: VersionForm = {
  enabled: true,
  latestVersion: '',
  latestBuild: '',
  minSupportedVersion: '',
  releaseNotes: '',
  storeUrl: '',
};

/** Same comparison the app uses, so the preview here can't disagree with it. */
function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = parseInt(pa[i] ?? '0', 10) || 0;
    const nb = parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

const VERSION_RE = /^\d+(\.\d+)*$/;

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 800,
  color: colors.text,
  marginBottom: 6,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: colors.muted,
  marginTop: 5,
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  fontSize: 14,
  color: colors.text,
  background: colors.surface,
  boxSizing: 'border-box',
};

export default function AppVersionPage() {
  const { isAdmin } = useAuth();
  const [form, setForm] = useState<VersionForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'config', 'appVersion'),
      (snap) => {
        const d = snap.data();
        if (d) {
          setForm({
            enabled: d.enabled !== false,
            latestVersion: typeof d.latestVersion === 'string' ? d.latestVersion : '',
            latestBuild: typeof d.latestBuild === 'number' ? String(d.latestBuild) : '',
            minSupportedVersion:
              typeof d.minSupportedVersion === 'string' ? d.minSupportedVersion : '',
            releaseNotes: typeof d.releaseNotes === 'string' ? d.releaseNotes : '',
            storeUrl: typeof d.storeUrl === 'string' ? d.storeUrl : '',
          });
        }
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, []);

  function set<K extends keyof VersionForm>(key: K, value: VersionForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  }

  async function save() {
    const latestVersion = form.latestVersion.trim();
    const minSupportedVersion = form.minSupportedVersion.trim();
    const buildRaw = form.latestBuild.trim();

    if (!latestVersion && !buildRaw) {
      setError('Enter the version that is live on the Play Store (or a build number).');
      return;
    }
    if (latestVersion && !VERSION_RE.test(latestVersion)) {
      setError('Latest version must be dotted numbers, e.g. 1.2.0.');
      return;
    }
    if (minSupportedVersion && !VERSION_RE.test(minSupportedVersion)) {
      setError('Minimum supported version must be dotted numbers, e.g. 1.0.0.');
      return;
    }
    if (
      latestVersion &&
      minSupportedVersion &&
      compareVersions(minSupportedVersion, latestVersion) > 0
    ) {
      setError(
        'The minimum supported version is higher than the version on the store — everyone would be force-blocked with nothing to update to.',
      );
      return;
    }
    let latestBuild: number | null = null;
    if (buildRaw) {
      const n = Number(buildRaw);
      if (!Number.isInteger(n) || n < 1) {
        setError('Build number must be a whole number (the Play Store version code).');
        return;
      }
      latestBuild = n;
    }

    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, 'config', 'appVersion'),
        {
          enabled: form.enabled,
          latestVersion,
          latestBuild,
          minSupportedVersion,
          releaseNotes: form.releaseNotes.trim(),
          storeUrl: form.storeUrl.trim(),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ color: colors.muted, padding: 20 }}>Loading…</div>;

  const forceFloor = form.minSupportedVersion.trim();

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>App version</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 700, lineHeight: 1.6 }}>
        Tell installed apps which version is live on the Play Store. Anyone running an older build
        gets an <strong>Update / Cancel</strong> prompt on launch; anyone already up to date sees
        nothing at all. Set this <strong>after</strong> the release has finished rolling out.
      </p>

      {error && (
        <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14, maxWidth: 700 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ Published</div>
      )}

      <Card style={{ maxWidth: 700, marginBottom: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 16,
            marginBottom: 18,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: colors.text }}>
              Update prompt {form.enabled ? 'on' : 'off'}
            </div>
            <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 1.5 }}>
              {form.enabled
                ? 'Older installs are told about the version below.'
                : 'No install will ever be prompted, whatever is set below.'}
            </div>
          </div>
          <button
            onClick={() => set('enabled', !form.enabled)}
            disabled={!isAdmin}
            aria-label="Toggle update prompt"
            style={{
              flexShrink: 0,
              width: 58,
              height: 32,
              borderRadius: 16,
              border: 'none',
              cursor: isAdmin ? 'pointer' : 'not-allowed',
              background: form.enabled ? colors.success : colors.border,
              position: 'relative',
              transition: 'background 0.15s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: form.enabled ? 29 : 3,
                width: 26,
                height: 26,
                borderRadius: 13,
                background: '#fff',
                transition: 'left 0.15s',
              }}
            />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Version live on the Play Store</label>
            <input
              style={inputStyle}
              value={form.latestVersion}
              placeholder="1.2.0"
              onChange={(e) => set('latestVersion', e.target.value)}
              disabled={!isAdmin}
            />
            <div style={hintStyle}>
              The <code>version</code> from app.json for the build you shipped. This is the number
              the prompt compares against.
            </div>
          </div>

          <div>
            <label style={labelStyle}>Build number (optional)</label>
            <input
              style={inputStyle}
              value={form.latestBuild}
              placeholder="13"
              onChange={(e) => set('latestBuild', e.target.value)}
              disabled={!isAdmin}
            />
            <div style={hintStyle}>
              The Android version code. Only needed when you ship a new build under the{' '}
              <em>same</em> version string — and only handsets that can report their own build
              number will act on it.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>What&apos;s new (optional)</label>
          <textarea
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
            value={form.releaseNotes}
            placeholder="Faster booking, live cars on the home map, bug fixes."
            onChange={(e) => set('releaseNotes', e.target.value)}
            disabled={!isAdmin}
          />
          <div style={hintStyle}>Shown inside the update dialogue. Keep it to a line or two.</div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Store link (optional)</label>
          <input
            style={inputStyle}
            value={form.storeUrl}
            placeholder={PLAY_URL}
            onChange={(e) => set('storeUrl', e.target.value)}
            disabled={!isAdmin}
          />
          <div style={hintStyle}>
            Leave blank to use the Play listing for <code>com.velocityridzpk.app</code>.
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Force update below version (optional)</label>
          <input
            style={inputStyle}
            value={form.minSupportedVersion}
            placeholder="leave blank"
            onChange={(e) => set('minSupportedVersion', e.target.value)}
            disabled={!isAdmin}
          />
          <div style={{ ...hintStyle, color: forceFloor ? colors.warn : colors.muted }}>
            {forceFloor
              ? `Anyone below ${forceFloor} gets a dialogue with NO Cancel button — they cannot use the app until they update. Only for a release that genuinely breaks compatibility.`
              : 'Blank means every prompt is dismissible. Set a version only when older builds truly cannot work any more.'}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <Button onClick={save} disabled={!isAdmin || busy}>
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </Card>

      <Card style={{ maxWidth: 700 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: colors.text, marginBottom: 8 }}>
          What users will see
        </div>
        <div style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.7 }}>
          {!form.enabled ? (
            <>Nothing — the prompt is switched off.</>
          ) : !form.latestVersion.trim() && !form.latestBuild.trim() ? (
            <>Nothing — no version has been published yet.</>
          ) : (
            <>
              On an install older than{' '}
              <strong style={{ color: colors.text }}>
                {form.latestVersion.trim() || `build ${form.latestBuild.trim()}`}
              </strong>
              : “{forceFloor ? 'Update required' : 'Update available'}” with{' '}
              {forceFloor ? (
                <strong style={{ color: colors.warn }}>Update now only</strong>
              ) : (
                <strong style={{ color: colors.text }}>Cancel and Update</strong>
              )}
              , once per app launch. On an install already at that version or newer:{' '}
              <strong style={{ color: colors.text }}>nothing</strong>.
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
