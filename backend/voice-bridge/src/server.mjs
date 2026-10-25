/**
 * The voice bridge: one Twilio call ⇄ one Gemini Live session.
 *
 * Twilio opens a WebSocket here when an AI agent's call is answered (the
 * TwiML from `agentVoiceAnswer`). This server:
 *   1. reads the call id and its one-time key from the stream's parameters,
 *   2. asks `agentVoiceSession` for a Live token locked to this call (it
 *      never holds a Gemini key, a Firestore credential or a lead's details),
 *   3. pipes the caller's audio to Gemini and Gemini's voice back to the call,
 *      clearing Twilio's buffer the moment the caller talks over the agent,
 *   4. when the agent calls `finish_call` (or anyone hangs up, or the time
 *      runs out) posts the transcript and the outcome to `agentVoiceResult`
 *      and closes the stream — which ends the call.
 *
 * It runs on Cloud Run because Cloud Functions cannot hold a WebSocket.
 * Nothing is stored here and nothing is logged about what was said.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { WebSocket, WebSocketServer } from 'ws';

import { Downsampler, mulawToPcm16 } from './audio.mjs';

const GEMINI_WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Caller audio goes to Gemini in 100 ms pieces rather than Twilio's 20 ms frames. */
const SEND_EVERY_BYTES = 800;
/** After finish_call: how long the goodbye may take before the line is closed anyway. */
const GOODBYE_MS = 8000;

const log = (msg, extra = {}) => console.log(JSON.stringify({ severity: 'INFO', message: `bridge: ${msg}`, ...extra }));
const warn = (msg, extra = {}) => console.log(JSON.stringify({ severity: 'WARNING', message: `bridge: ${msg}`, ...extra }));

class Call {
  constructor(twilio, cfg) {
    this.twilio = twilio;
    this.cfg = cfg;
    this.streamSid = '';
    this.callId = '';
    this.key = '';
    this.gemini = null;
    this.ready = false;
    this.pending = [];
    this.inbound = [];
    this.inboundBytes = 0;
    this.down = new Downsampler();
    this.transcript = [];
    this.outcome = null;
    this.ending = false;
    this.done = false;
    this.error = '';
    this.timers = [];

    twilio.on('message', (raw) => this.fromTwilio(raw));
    twilio.on('close', () => this.finish('the caller hung up'));
    twilio.on('error', (e) => this.finish(`twilio socket: ${e.message}`));
  }

  async fromTwilio(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.event === 'start') {
      this.streamSid = msg.start?.streamSid ?? msg.streamSid ?? '';
      const p = msg.start?.customParameters ?? {};
      this.callId = String(p.callId ?? '');
      this.key = String(p.key ?? '');
      await this.open();
    } else if (msg.event === 'media' && msg.media?.track !== 'outbound') {
      this.toGemini(Buffer.from(msg.media?.payload ?? '', 'base64'));
    } else if (msg.event === 'mark' && msg.mark?.name === 'goodbye') {
      this.finish();
    } else if (msg.event === 'stop') {
      this.finish('the call ended');
    }
  }

  async open() {
    let session;
    try {
      const res = await fetch(`${this.cfg.functionsUrl}/agentVoiceSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callId: this.callId, key: this.key }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`session HTTP ${res.status}`);
      session = await res.json();
    } catch (e) {
      return this.finish(`no voice session: ${e.message}`);
    }
    this.timers.push(setTimeout(() => this.finish('the call reached its time limit'), (session.maxSeconds ?? 480) * 1000));

    const ws = new WebSocket(`${this.cfg.geminiUrl}?access_token=${encodeURIComponent(session.token)}`);
    this.gemini = ws;
    ws.on('open', () => ws.send(JSON.stringify({ setup: { model: `models/${session.model}` } })));
    ws.on('message', (raw) => this.fromGemini(raw));
    ws.on('close', (code, reason) => {
      if (!this.done) this.finish(this.outcome ? undefined : `the voice closed (${code} ${String(reason).slice(0, 120)})`);
    });
    ws.on('error', (e) => this.finish(`voice socket: ${e.message}`));
  }

  send(obj) {
    if (this.gemini?.readyState === WebSocket.OPEN) this.gemini.send(JSON.stringify(obj));
  }

  toTwilio(obj) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ ...obj, streamSid: this.streamSid }));
  }

  toGemini(mulaw) {
    if (!this.ready || this.ending) return;
    this.inbound.push(mulaw);
    this.inboundBytes += mulaw.length;
    if (this.inboundBytes < SEND_EVERY_BYTES) return;
    const pcm = mulawToPcm16(Buffer.concat(this.inbound));
    this.inbound = [];
    this.inboundBytes = 0;
    this.send({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=8000' } } });
  }

  said(who, text) {
    if (!text) return;
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.who === who) last.text = `${last.text}${text}`.slice(0, 2000);
    else if (this.transcript.length < 400) this.transcript.push({ who, text: text.slice(0, 2000) });
  }

  fromGemini(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.setupComplete) {
      this.ready = true;
      // The agent speaks first, as a caller would expect from whoever rang them.
      this.send({ realtimeInput: { text: '[call connected]' } });
      return;
    }
    const sc = msg.serverContent;
    if (sc?.interrupted) this.toTwilio({ event: 'clear' });
    for (const part of sc?.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (!data) continue;
      const mulaw = this.down.push(Buffer.from(data, 'base64'));
      if (mulaw.length) this.toTwilio({ event: 'media', media: { payload: mulaw.toString('base64') } });
    }
    this.said('them', sc?.inputTranscription?.text);
    this.said('agent', sc?.outputTranscription?.text);
    if (sc?.turnComplete && this.ending) this.goodbye();

    for (const fc of msg.toolCall?.functionCalls ?? []) {
      if (fc.name === 'finish_call') {
        const a = fc.args ?? {};
        this.outcome = {
          result: typeof a.result === 'string' ? a.result : null,
          summary: String(a.summary ?? '').slice(0, 1500),
          whatsappOk: a.whatsapp_ok === true,
          callbackWhen: String(a.callback_when ?? '').slice(0, 300),
          deal: String(a.deal ?? '').slice(0, 1500),
        };
        this.ending = true;
        this.send({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result: 'recorded' } }] } });
        // If nothing more is said, close after the goodbye already queued has played.
        this.timers.push(setTimeout(() => this.goodbye(), 1500));
        this.timers.push(setTimeout(() => this.finish(), GOODBYE_MS));
      }
    }
  }

  /** Ask Twilio to say when everything sent so far has played; the echo closes the call. */
  goodbye() {
    if (this.saidGoodbye) return;
    this.saidGoodbye = true;
    this.toTwilio({ event: 'mark', mark: { name: 'goodbye' } });
  }

  async finish(reason) {
    if (this.done) return;
    this.done = true;
    for (const t of this.timers) clearTimeout(t);
    if (reason && !this.outcome) this.error = reason;
    try {
      this.gemini?.close();
    } catch {
      /* already closed */
    }
    if (this.callId && this.key) {
      const outcome = this.outcome ?? { result: null, summary: '', whatsappOk: false, callbackWhen: '', deal: '' };
      const known = ['interested', 'meeting', 'deal', 'callback', 'not_interested', 'do_not_call', 'wrong_number', 'voicemail'];
      try {
        await fetch(`${this.cfg.functionsUrl}/agentVoiceResult`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            callId: this.callId,
            key: this.key,
            transcript: this.transcript,
            ...outcome,
            result: known.includes(outcome.result) ? outcome.result : null,
            ...(this.error ? { error: this.error.slice(0, 300) } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        warn('could not post the result', { callId: this.callId, message: e.message });
      }
    }
    log('call finished', { callId: this.callId, lines: this.transcript.length, result: this.outcome?.result ?? null, error: this.error || null });
    // Closing the stream ends the call: nothing follows <Connect> in the TwiML.
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.close();
  }
}

/** Start the bridge. Tests point `geminiUrl` and `functionsUrl` at fakes. */
export function startServer({ port = 8080, functionsUrl, geminiUrl = GEMINI_WS } = {}) {
  if (!functionsUrl) throw new Error('FUNCTIONS_URL is required');
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') return res.end('ok');
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, path: '/stream' });
  wss.on('connection', (ws) => new Call(ws, { functionsUrl: functionsUrl.replace(/\/+$/, ''), geminiUrl }));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8080);
  await startServer({ port, functionsUrl: process.env.FUNCTIONS_URL, geminiUrl: process.env.GEMINI_WS_URL || GEMINI_WS });
  log('listening', { port });
}
