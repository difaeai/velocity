'use client';

/**
 * Manage social → Automation.
 *
 * Everything the unattended daily job reads. The defaults are deliberately
 * timid — automation off, approval required, no video renderer — because the
 * dangerous configuration is one where a machine posts to a real audience
 * before anyone has read a single thing it wrote.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { colors } from '@/lib/config';
import { socialApi, SOCIAL_PLATFORMS, type SocialPlatform, type SocialSettings } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge, PLATFORM_META, Readiness } from '@/components/social/shared';

/** Networks the backend can actually push a video to (VIDEO_CAPABLE). */
const PUBLISHABLE: SocialPlatform[] = ['facebook', 'instagram', 'threads', 'tiktok', 'youtube'];

export default function AutomationPage() {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [readiness, setReadiness] = useState<{ writer: boolean; video: boolean; tokenVault: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setReadiness(r.readiness);
      })
      .catch((e) => setMessage({ kind: 'bad', text: e instanceof Error ? e.message : 'Could not load settings.' }));
  }, []);

  function edit(patch: Partial<SocialSettings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await socialApi.updateSettings({
        enabled: settings.enabled,
        runHour: settings.runHour,
        platforms: settings.platforms,
        requireApproval: settings.requireApproval,
        videoProvider: settings.videoProvider,
        videoModel: settings.videoModel,
        aspect: settings.aspect,
        angles: settings.angles,
        brandVoice: settings.brandVoice,
      });
      setSettings(r.settings);
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <p style={{ color: colors.muted }}>{message?.text ?? 'Loading…'}</p>;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Automation</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          What the daily job does, and whether it does it without asking.
        </p>
      </header>

      {readiness ? (
        <Card style={{ marginBottom: 16 }}>
          <h2 style={h2}>Wiring</h2>
          <Readiness readiness={readiness} connectedCount={settings.platforms.length} />
        </Card>
      ) : null}

      <Card style={{ marginBottom: 16 }}>
        <h2 style={h2}>The schedule</h2>

        <Toggle
          checked={settings.enabled}
          onChange={(v) => edit({ enabled: v })}
          label="Run every day"
          hint="Off means nothing happens on its own. You can still draft and publish by hand from the calendar and the queue."
        />

        <label style={{ display: 'grid', gap: 4, marginTop: 16 }}>
          <span style={labelStyle}>Post at</span>
          <select
            value={settings.runHour}
            onChange={(e) => edit({ runHour: Number(e.target.value) })}
            style={{ ...inputStyle, maxWidth: 220 }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00 PKT
              </option>
            ))}
          </select>
          <span style={hintStyle}>
            Pakistan time. Evening tends to beat morning for a consumer app — try 19:00 or 20:00.
          </span>
        </label>

        <div style={{ marginTop: 16 }}>
          <Toggle
            checked={settings.requireApproval}
            onChange={(v) => edit({ requireApproval: v })}
            label="A human approves every post"
            hint="Strongly recommended. With this off, whatever the model writes goes live unread — and every claim in it is Velocity's claim."
          />
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <h2 style={h2}>Where it posts</h2>
        <p style={{ ...hintStyle, marginTop: 0, marginBottom: 12 }}>
          Only networks with a working connection are used at publish time — see{' '}
          <Link href="/dashboard/social/accounts" style={{ color: colors.secondary, fontWeight: 700 }}>
            connected accounts
          </Link>
          .
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {SOCIAL_PLATFORMS.map((p) => {
            const supported = PUBLISHABLE.includes(p);
            return (
              <label
                key={p}
                style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: supported ? 1 : 0.5, cursor: supported ? 'pointer' : 'not-allowed' }}
              >
                <input
                  type="checkbox"
                  disabled={!supported}
                  checked={settings.platforms.includes(p)}
                  onChange={(e) =>
                    edit({
                      platforms: e.target.checked
                        ? [...settings.platforms, p]
                        : settings.platforms.filter((x) => x !== p),
                    })
                  }
                />
                <PlatformBadge platform={p} size={22} />
                <span style={{ fontSize: 13.5, flex: 1 }}>{PLATFORM_META[p].label}</span>
                {!supported ? (
                  <span style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>NO VIDEO POSTING YET</span>
                ) : null}
              </label>
            );
          })}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <h2 style={h2}>The video</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>Renderer</span>
          <select
            value={settings.videoProvider}
            onChange={(e) => edit({ videoProvider: e.target.value as SocialSettings['videoProvider'] })}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            <option value="none">None — I attach the file myself</option>
            <option value="veo">Google Veo (Gemini API)</option>
          </select>
          <span style={hintStyle}>
            With none, the job still writes the script and the caption and leaves the post in the queue
            waiting for a file. That is the cheap way to run this while you decide on a vendor.
          </span>
        </label>

        {settings.videoProvider !== 'none' ? (
          <>
            <label style={{ display: 'grid', gap: 4, marginTop: 14 }}>
              <span style={labelStyle}>Model</span>
              <input
                value={settings.videoModel}
                onChange={(e) => edit({ videoModel: e.target.value })}
                style={{ ...inputStyle, maxWidth: 320 }}
              />
              <span style={hintStyle}>
                Whatever the Gemini API currently calls the Veo model. Render one from the queue and watch
                the logs before switching the daily job on.
              </span>
            </label>

            <label style={{ display: 'grid', gap: 4, marginTop: 14 }}>
              <span style={labelStyle}>Shape</span>
              <select
                value={settings.aspect}
                onChange={(e) => edit({ aspect: e.target.value as SocialSettings['aspect'] })}
                style={{ ...inputStyle, maxWidth: 320 }}
              >
                <option value="9:16">9:16 — Reels, Shorts, TikTok</option>
                <option value="16:9">16:9 — YouTube proper</option>
              </select>
            </label>
          </>
        ) : null}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <h2 style={h2}>What it writes about</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>Angle rotation</span>
          <textarea
            value={settings.angles.join('\n')}
            onChange={(e) =>
              edit({ angles: e.target.value.split('\n').map((a) => a.trim()).filter(Boolean) })
            }
            rows={Math.max(5, settings.angles.length + 1)}
            style={{ ...inputStyle, height: 'auto', padding: 10, lineHeight: 1.6, resize: 'vertical' }}
          />
          <span style={hintStyle}>
            One angle per line, used in order, one a day. Rotating them is what stops the feed becoming
            the same post with different words.
          </span>
        </label>

        <label style={{ display: 'grid', gap: 4, marginTop: 16 }}>
          <span style={labelStyle}>Direction for the writer</span>
          <textarea
            value={settings.brandVoice}
            onChange={(e) => edit({ brandVoice: e.target.value })}
            rows={4}
            placeholder="Current promotions, phrases to avoid, cities to focus on, anything the model should know this month."
            style={{ ...inputStyle, height: 'auto', padding: 10, lineHeight: 1.6, resize: 'vertical' }}
          />
          <span style={hintStyle}>
            Appended to every prompt. The model is already told never to invent a number — this is for
            tone and current context.
          </span>
        </label>
      </Card>

      {message ? (
        <p style={{ fontSize: 13.5, color: message.kind === 'ok' ? colors.success : colors.danger }}>{message.text}</p>
      ) : null}

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 13.5, fontWeight: 700, display: 'block' }}>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </span>
    </label>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 14px' };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700 };
const hintStyle: React.CSSProperties = { fontSize: 12.5, color: colors.muted, lineHeight: 1.5, display: 'block' };
const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 10px',
  fontSize: 14,
  fontFamily: 'inherit',
  background: colors.surface,
  width: '100%',
};
