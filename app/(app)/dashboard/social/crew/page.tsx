'use client';

/**
 * Manage social → The crew.
 *
 * Who the four agents are, and the one place you tell them things.
 *
 * The distinction that matters on this screen: **standing instructions apply to
 * every run, forever**, where feedback in the approval queue applies to one
 * post. "Never use the word seamless" belongs here. "This particular hook is
 * weak" belongs in the queue. Putting them in the same box would mean either
 * repeating yourself every morning or accidentally making one post's note into
 * a permanent rule.
 *
 * Everything on this page is read by the agents at the top of their prompt on
 * every single run, which is also why it is worth keeping short.
 */

import { useEffect, useState } from 'react';

import { colors } from '@/lib/config';
import {
  SOCIAL_AGENTS,
  socialApi,
  type SocialAgent,
  type SocialCompetitor,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { AGENT_META, Mascot } from '@/components/social/shared';

export default function CrewPage() {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [draft, setDraft] = useState<Partial<SocialSettings>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    socialApi
      .getSettings({})
      .then((r) => setSettings(r.settings))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the settings.'));
  }, []);

  const value = <K extends keyof SocialSettings>(key: K): SocialSettings[K] | undefined =>
    (draft[key] ?? settings?.[key]) as SocialSettings[K] | undefined;

  const set = <K extends keyof SocialSettings>(key: K, v: SocialSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  async function save() {
    if (!Object.keys(draft).length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await socialApi.updateSettings(draft);
      setSettings(res.settings);
      setDraft({});
      setNotice('Saved. Every agent reads this on their next run.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <Card>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>{error ?? 'Loading the crew…'}</p>
      </Card>
    );
  }

  const competitors = (value('competitors') ?? []) as SocialCompetitor[];
  const notes = (value('agentNotes') ?? { qalam: '', rang: '', raftar: '', awaaz: '' }) as Record<
    SocialAgent,
    string
  >;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>The crew</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          Four agents who plan every piece together before any of them starts working. Tell them something here and
          they all remember it.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {/* who they are */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        {SOCIAL_AGENTS.map((agent) => (
          <Card key={agent}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              <Mascot agent={agent} size={52} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>{AGENT_META[agent].name}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: AGENT_META[agent].colour === '#ccff00' ? colors.primary : colors.muted }}>
                  {AGENT_META[agent].role}
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.5, margin: '0 0 10px' }}>
              {AGENT_META[agent].does}
            </p>
            <label style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>
              DIRECTION FOR {AGENT_META[agent].name.toUpperCase()} ONLY
            </label>
            <textarea
              value={notes[agent] ?? ''}
              onChange={(e) => set('agentNotes', { ...notes, [agent]: e.target.value })}
              rows={3}
              placeholder={
                agent === 'qalam'
                  ? 'e.g. lead with drivers, not riders, until we have 500 cars'
                  : agent === 'rang'
                    ? 'e.g. no stock-looking studio shots — street light only'
                    : agent === 'raftar'
                      ? 'e.g. keep it under 15 seconds, cut on the beat'
                      : 'e.g. never reply to price arguments, send them to support'
              }
              style={{
                width: '100%',
                marginTop: 4,
                padding: 9,
                fontSize: 12.5,
                fontFamily: 'inherit',
                border: `1px solid ${colors.border}`,
                borderRadius: 9,
                resize: 'vertical',
              }}
            />
          </Card>
        ))}
      </div>

      {/* what they all read */}
      <Card>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Standing instructions</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 10px' }}>
          Read by all four, on every run, before anything else. Tone, this month’s promotion, claims to avoid, words
          you never want to see again. Keep it short — this is a rule sheet, not a brief.
        </p>
        <textarea
          value={(value('crewInstructions') as string) ?? ''}
          onChange={(e) => set('crewInstructions', e.target.value)}
          rows={7}
          placeholder={
            'e.g.\n- We are recruiting drivers in Lahore this month. Bias towards driver-side stories.\n- Never say "cheapest". Say the rider names the fare.\n- Always show a real Pakistani street, never a generic city.\n- Urdu in the voiceover, English on screen.'
          }
          style={{
            width: '100%',
            padding: 11,
            fontSize: 13,
            lineHeight: 1.55,
            fontFamily: 'inherit',
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            resize: 'vertical',
          }}
        />
      </Card>

      {/* what Qalam reads around */}
      <Card>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>What Qalam reads before writing</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
          Once a day, Qalam searches for what is travelling in this market and what these apps are publishing, and
          brings it to standup. The crew is barred from naming any of them in a post — this is for reading the room,
          not for copying anyone.
        </p>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={(value('researchEnabled') as boolean) ?? true}
            onChange={(e) => set('researchEnabled', e.target.checked)}
          />
          <span style={{ fontWeight: 700 }}>Search the market before writing</span>
        </label>

        <div style={{ display: 'grid', gap: 8 }}>
          {competitors.map((competitor, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={competitor.name}
                onChange={(e) => {
                  const next = [...competitors];
                  next[i] = { ...competitor, name: e.target.value };
                  set('competitors', next);
                }}
                placeholder="Name"
                style={{ ...inputStyle, width: 150 }}
              />
              <input
                value={competitor.url}
                onChange={(e) => {
                  const next = [...competitors];
                  next[i] = { ...competitor, url: e.target.value };
                  set('competitors', next);
                }}
                placeholder="https://…"
                style={{ ...inputStyle, flex: 1 }}
              />
              <Button
                variant="ghost"
                onClick={() => set('competitors', competitors.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="ghost"
              onClick={() => set('competitors', [...competitors, { name: '', url: '' }])}
              disabled={competitors.length >= 12}
            >
              Add another
            </Button>
          </div>
        </div>
      </Card>

      {/* the engines */}
      <Card>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Engines</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
          All four run on Google Gemini, on one key. Model ids are editable because Google renames preview models
          often — when a name changes, this is the fix, not a redeploy.
        </p>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field label="Writing and planning" hint="Qalam, and the standup. Also drafts comment replies.">
            <input
              value={(value('textModel') as string) ?? ''}
              onChange={(e) => set('textModel', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Images" hint="Rang. Carousel slides, post images, story frames, video covers.">
            <input
              value={(value('imageModel') as string) ?? ''}
              onChange={(e) => set('imageModel', e.target.value)}
              style={inputStyle}
            />
            <select
              value={(value('imageProvider') as string) ?? 'gemini'}
              onChange={(e) => set('imageProvider', e.target.value as 'gemini' | 'none')}
              style={{ ...inputStyle, marginTop: 6 }}
            >
              <option value="gemini">Render images</option>
              <option value="none">Direction only — I will attach files</option>
            </select>
          </Field>
          <Field label="Video" hint="Raftar. Veo, through the same Gemini key.">
            <input
              value={(value('videoModel') as string) ?? ''}
              onChange={(e) => set('videoModel', e.target.value)}
              style={inputStyle}
            />
            <select
              value={(value('videoProvider') as string) ?? 'none'}
              onChange={(e) => set('videoProvider', e.target.value as 'veo' | 'none')}
              style={{ ...inputStyle, marginTop: 6 }}
            >
              <option value="veo">Render video</option>
              <option value="none">Cut only — I will attach the file</option>
            </select>
          </Field>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button onClick={save} disabled={busy || !Object.keys(draft).length}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {Object.keys(draft).length ? (
          <span style={{ fontSize: 12.5, color: colors.warn }}>Unsaved changes.</span>
        ) : null}
      </div>
    </div>
  );
}

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
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: colors.muted, marginBottom: 6 }}>{hint}</div>
      {children}
    </div>
  );
}
