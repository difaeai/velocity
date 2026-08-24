'use client';

/**
 * Manage social → Automation.
 *
 * When the team works and what they work on. Who they are and what they *say*
 * lives on the Employees page; this screen is the timetable.
 *
 * There is no auto-publish switch. Every run ends in the approval queue, by
 * design — see the header of the backend's pipeline.ts. The one switch on this
 * page that puts words in front of customers without a human is auto-reply, and
 * it is guarded, off by default, and never applies to comments read as safety
 * issues.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { colors } from '@/lib/config';
import {
  SOCIAL_FORMATS,
  SOCIAL_PLATFORMS,
  platformTakes,
  socialApi,
  type SocialFormat,
  type SocialPlatform,
  type SocialReadiness,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { FORMAT_META, PLATFORM_META, PlatformBadge, Readiness } from '@/components/social/shared';

export default function AutomationPage() {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<SocialReadiness | null>(null);
  const [staffed, setStaffed] = useState(0);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setReadiness(r.readiness);
        setStaffed(r.staffed);
        setCoverage(r.coverage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the settings.'));
  }, []);

  function edit(patch: Partial<SocialSettings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
    setNotice(null);
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await socialApi.updateSettings({
        enabled: settings.enabled,
        runHour: settings.runHour,
        postsPerDay: settings.postsPerDay,
        platforms: settings.platforms,
        formats: settings.formats,
        angles: settings.angles,
        engagementEnabled: settings.engagementEnabled,
        autoReply: settings.autoReply,
      });
      setSettings(res.settings);
      setDirty(false);
      setNotice('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <Card>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>{error ?? 'Loading…'}</p>
      </Card>
    );
  }

  const toggleFormat = (format: SocialFormat) => {
    const on = settings.formats.includes(format);
    const next = on ? settings.formats.filter((f) => f !== format) : [...settings.formats, format];
    if (next.length) edit({ formats: next });
  };

  const togglePlatform = (platform: SocialPlatform) =>
    edit({
      platforms: settings.platforms.includes(platform)
        ? settings.platforms.filter((p) => p !== platform)
        : [...settings.platforms, platform],
    });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Automation</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          When the crew works, what they make, and where it goes. What they say is on the{' '}
          <Link href="/dashboard/social/crew" style={{ color: colors.secondary, fontWeight: 700 }}>
            crew page
          </Link>
          .
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {readiness ? (
        <Card>
          <h2 style={h2}>Before it can run</h2>
          <Readiness readiness={readiness} connectedCount={settings.platforms.length} staffed={staffed} />
          {coverage.length ? (
            <p style={{ fontSize: 12.5, color: colors.warn, margin: '12px 0 0', lineHeight: 1.5 }}>
              {coverage[0]}{' '}
              <Link href="/dashboard/social/employees" style={{ color: colors.secondary, fontWeight: 700 }}>
                Hire someone →
              </Link>
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 style={h2}>The schedule</h2>
        <Toggle
          checked={settings.enabled}
          onChange={(v) => edit({ enabled: v })}
          label="Run every day"
          hint="Off means the crew only works when you press “Brief the crew” on the overview."
        />

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 14 }}>
          <Field label="Hour of the day (PKT)" hint="When the crew starts. Everything lands in the queue.">
            <select
              value={settings.runHour}
              onChange={(e) => edit({ runHour: Number(e.target.value) })}
              style={inputStyle}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pieces a day" hint="Each one takes the next format in the rotation.">
            <select
              value={settings.postsPerDay}
              onChange={(e) => edit({ postsPerDay: Number(e.target.value) })}
              style={inputStyle}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p style={{ fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 0 }}>
          Nothing publishes itself. Every piece stops in the approval queue for you to approve, send back, reject or
          delete.
        </p>
      </Card>

      <Card>
        <h2 style={h2}>The format rotation</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
          Runs in order and repeats, so the grid is not five videos deep. Reels appear more than once on purpose —
          they are what travels.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {SOCIAL_FORMATS.map((format) => {
            const count = settings.formats.filter((f) => f === format).length;
            return (
              <button
                key={format}
                onClick={() => toggleFormat(format)}
                title={FORMAT_META[format].note}
                style={{
                  border: `1px solid ${count ? colors.primary : colors.border}`,
                  background: count ? `${colors.primary}12` : 'transparent',
                  color: count ? colors.primary : colors.muted,
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {FORMAT_META[format].glyph} {FORMAT_META[format].label}
                {count > 1 ? ` ×${count}` : ''}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12.5, color: colors.muted }}>
          Order: {settings.formats.map((f) => FORMAT_META[f].label).join(' → ')} → repeat
        </div>
      </Card>

      <Card>
        <h2 style={h2}>Where it goes</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
          The default targets. The social manager narrows them per piece — a story never goes to YouTube, whatever is
          ticked here.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {SOCIAL_PLATFORMS.map((platform) => {
            const on = settings.platforms.includes(platform);
            const takes = SOCIAL_FORMATS.filter((f) => platformTakes(platform, f));
            return (
              <label
                key={platform}
                style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
              >
                <input type="checkbox" checked={on} onChange={() => togglePlatform(platform)} />
                <PlatformBadge platform={platform} size={26} />
                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 120 }}>
                  {PLATFORM_META[platform].label}
                </span>
                <span style={{ fontSize: 12, color: colors.muted }}>
                  takes {takes.map((f) => FORMAT_META[f].label.toLowerCase()).join(', ')}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 style={h2}>The angle rotation</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 10px' }}>
          One angle per run, in order, so the feed does not become the same post with different words. One per line.
        </p>
        <textarea
          value={settings.angles.join('\n')}
          onChange={(e) =>
            edit({ angles: e.target.value.split('\n').map((a) => a.trim()).filter(Boolean) })
          }
          rows={6}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
        />
      </Card>

      <Card>
        <h2 style={h2}>Comments</h2>
        <Toggle
          checked={settings.engagementEnabled}
          onChange={(v) => edit({ engagementEnabled: v, ...(v ? {} : { autoReply: false }) })}
          label="Read the comments every two hours"
          hint="Awaaz pulls in what people said under everything published in the last fortnight and drafts a reply to each."
        />
        <div style={{ marginTop: 12 }}>
          <Toggle
            checked={settings.autoReply}
            onChange={(v) => edit({ autoReply: v })}
            disabled={!settings.engagementEnabled}
            label="Send those replies without me reading them"
            hint="Leave this off until you have read a few dozen drafts. Safety comments and spam are never auto-sent either way."
          />
        </div>
        {settings.lastEngagementAtMs ? (
          <p style={{ fontSize: 12.5, color: colors.muted, marginTop: 12, marginBottom: 0 }}>
            Last check: {new Date(settings.lastEngagementAtMs).toLocaleString('en-PK')} —{' '}
            {settings.lastEngagementStatus}
          </p>
        ) : null}
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {dirty ? <span style={{ fontSize: 12.5, color: colors.warn }}>Unsaved changes.</span> : null}
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
  background: colors.surface,
  color: colors.text,
};

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: colors.muted, marginBottom: 6 }}>{hint}</div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span>
        <span style={{ fontSize: 13.5, fontWeight: 700, display: 'block' }}>{label}</span>
        <span style={{ fontSize: 12.5, color: colors.muted }}>{hint}</span>
      </span>
    </label>
  );
}
