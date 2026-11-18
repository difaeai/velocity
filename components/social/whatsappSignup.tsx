'use client';

/**
 * "Connect WhatsApp", as one button.
 *
 * The card beside this one still takes a pasted phone number id, permanent
 * token and app secret, and that path stays for anyone who already has them.
 * But three values from three screens of a developer console is the reason no
 * customer has ever connected a number. This is the same connection made the
 * way Meta intends: Embedded Signup, where Meta's own window walks the client
 * through choosing a business, a number and a display name.
 *
 * Two things make this flow different from the Instagram one next door:
 *
 * - **Nothing comes back through a redirect.** Meta's window posts the WhatsApp
 *   account id and phone number id to this page as a `message`, and hands the
 *   code to the SDK callback. Neither is useful without the other, so both are
 *   held here until the pair is complete and then sent together.
 * - **The window can close without finishing.** A client who backs out at the
 *   number step leaves a `CANCEL` event and no code, which is a normal thing to
 *   do and says so rather than hanging on "connecting…".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { colors } from '@/lib/config';
import { agentsApi, type WhatsAppTemplate } from '@/lib/api';
import { Button, Card } from '@/components/ui';

type Step = 'idle' | 'opening' | 'finishing' | 'done';

interface SignupState {
  ready: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  vaultReady: boolean;
  connected: { displayNumber: string; verifiedName: string } | null;
  missing: string[];
}

/** What Meta's window posts back as the client moves through it. */
interface SignupMessage {
  type?: string;
  event?: 'FINISH' | 'CANCEL' | 'ERROR' | string;
  data?: { phone_number_id?: string; waba_id?: string; current_step?: string; error_message?: string };
}

declare global {
  interface Window {
    FB?: {
      init: (o: Record<string, unknown>) => void;
      login: (cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Load Meta's SDK once per page, and only when there is an app id to load it for. */
function useFacebookSdk(appId: string | null, version: string): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      setReady(true);
    };
    const id = 'facebook-jssdk';
    if (document.getElementById(id)) return;
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.body.appendChild(s);
  }, [appId, version]);
  return ready;
}

export function WhatsAppSignup({ onConnected }: { onConnected?: () => void }) {
  const [state, setState] = useState<SignupState | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The two halves of a finished signup, which arrive by different routes.
  const assets = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await agentsApi.whatsAppSignupState({}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sdkReady = useFacebookSdk(state?.ready ? state.appId : null, state?.graphVersion ?? 'v21.0');

  // Meta posts the account and number ids here as the client picks them.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.origin.endsWith('facebook.com')) return;
      let msg: SignupMessage;
      try {
        msg = typeof ev.data === 'string' ? (JSON.parse(ev.data) as SignupMessage) : (ev.data as SignupMessage);
      } catch {
        return;
      }
      if (msg?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (msg.event === 'FINISH' && msg.data?.waba_id && msg.data?.phone_number_id) {
        assets.current = { wabaId: msg.data.waba_id, phoneNumberId: msg.data.phone_number_id };
      } else if (msg.event === 'CANCEL') {
        assets.current = null;
        setStep('idle');
        setNote(`Closed at the ${msg.data?.current_step ?? 'last'} step — nothing was connected.`);
      } else if (msg.event === 'ERROR') {
        assets.current = null;
        setStep('idle');
        setError(msg.data?.error_message ?? 'Meta reported an error during sign-up.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const connect = useCallback(() => {
    if (!window.FB || !state?.configId) return;
    setError(null);
    setNote(null);
    assets.current = null;
    setStep('opening');

    window.FB.login(
      async (res) => {
        const code = res?.authResponse?.code;
        // No code means the window was closed before the end. The CANCEL
        // handler above has usually already said so.
        if (!code) {
          setStep((s) => (s === 'opening' ? 'idle' : s));
          return;
        }
        if (!assets.current) {
          setStep('idle');
          setError('Meta returned a sign-in but not the number. Press Connect again.');
          return;
        }
        setStep('finishing');
        try {
          const out = await agentsApi.finishWhatsAppSignup({ code, ...assets.current });
          setStep('done');
          setNote(
            out.needsTemplate
              ? 'Connected. Add a message template before the first outbound message — replies inside 24 hours need none.'
              : 'Connected.',
          );
          await refresh();
          onConnected?.();
        } catch (e) {
          setStep('idle');
          setError((e as Error).message);
        }
      },
      {
        config_id: state.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  }, [state, refresh, onConnected]);

  if (!state) return null;

  if (!state.ready) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
          One-press WhatsApp connect is not set up yet. Missing: <strong>{state.missing.join(', ')}</strong>. Until
          then, a number can still be connected by pasting its token below.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800 }}>
        {state.connected ? 'WhatsApp is connected' : 'Connect WhatsApp in one step'}
      </h3>
      <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
        {state.connected
          ? `Messaging as ${state.connected.verifiedName || state.connected.displayNumber}. Connecting again replaces the stored number.`
          : 'Meta walks you through picking the business, the number and the display name. Nothing is pasted here, and the token never touches this page.'}
      </p>

      <Button onClick={connect} disabled={!sdkReady || step === 'opening' || step === 'finishing'}>
        {step === 'opening'
          ? 'Waiting for Meta…'
          : step === 'finishing'
            ? 'Finishing…'
            : state.connected
              ? 'Connect a different number'
              : 'Connect WhatsApp'}
      </Button>

      {note ? (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '12px 0 0', lineHeight: 1.5 }}>{note}</p>
      ) : null}
      {error ? (
        <p style={{ fontSize: 12.5, color: '#b42318', margin: '12px 0 0', lineHeight: 1.5 }}>{error}</p>
      ) : null}
    </Card>
  );
}

/**
 * Message templates, and where Meta's review of each one got to.
 *
 * A template is the only way to write to somebody more than 24 hours after
 * their last message, so until one is approved the desk can answer but never
 * open a conversation. Nothing here can hurry the review: it is submitted, it
 * says PENDING, and then it is approved or it is not.
 *
 * Templates belong to the WhatsApp Business account, which only a line
 * connected through Embedded Signup records — a pasted token says nothing
 * about which account it came from. That is what the backend refuses with, and
 * this card shows that refusal rather than hiding itself.
 */
export function WhatsAppTemplates() {
  const [rows, setRows] = useState<WhatsAppTemplate[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    agentsApi
      .templates({})
      .then((r) => {
        setRows(r.templates);
        setWhy(null);
      })
      .catch((e) => {
        setRows([]);
        setWhy(e instanceof Error ? e.message : 'Templates could not be read.');
      });
  }, []);

  useEffect(load, [load]);

  const field = {
    padding: '9px 11px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
  } as const;

  const tone = (status: string) =>
    status === 'APPROVED' ? '#28c76f' : status === 'REJECTED' ? '#b42318' : colors.muted;

  return (
    <Card>
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 6px' }}>Message templates</h3>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
        The only way to write to somebody more than 24 hours after their last message. Meta reviews every one.
      </p>

      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          placeholder="template_name"
          style={field}
        />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What it says." rows={3} style={{ ...field, resize: 'vertical' }} />
        <div>
          <Button
            variant="secondary"
            disabled={busy || !name.trim() || !body.trim()}
            onClick={() => {
              setBusy(true);
              setNote(null);
              agentsApi
                .submitTemplate({ name: name.trim(), body: body.trim() })
                .then((out) => {
                  setNote(`Submitted. Meta says ${out.status}.`);
                  setName('');
                  setBody('');
                  load();
                })
                .catch((e) => setWhy(e instanceof Error ? e.message : 'Meta would not take that template.'))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Submitting…' : 'Submit for review'}
          </Button>
        </div>
      </div>

      {rows === null ? null : rows.length ? (
        rows.map((t) => (
          <div
            key={`${t.name}-${t.language ?? ''}`}
            style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: `1px solid ${colors.border}` }}
          >
            <strong style={{ fontSize: 13, flex: 1 }}>{t.name}</strong>
            <span style={{ fontSize: 11.5, color: colors.muted }}>{t.language ?? ''}</span>
            <span style={{ fontSize: 11, fontWeight: 900, color: tone(t.status), textTransform: 'uppercase' }}>{t.status}</span>
          </div>
        ))
      ) : (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: 0 }}>No templates yet.</p>
      )}

      {note ? <p style={{ fontSize: 12.5, color: colors.muted, margin: '12px 0 0' }}>{note}</p> : null}
      {why ? <p style={{ fontSize: 12.5, color: '#b42318', margin: '12px 0 0', lineHeight: 1.5 }}>{why}</p> : null}
    </Card>
  );
}
