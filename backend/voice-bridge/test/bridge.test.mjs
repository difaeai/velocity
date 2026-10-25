import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { Downsampler, linearToMulaw, mulawToPcm16 } from '../src/audio.mjs';
import { startServer } from '../src/server.mjs';

test('μ-law survives a round trip within its quantisation step', () => {
  for (const s of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
    const back = mulawToPcm16(Buffer.from([linearToMulaw(s)])).readInt16LE(0);
    assert.ok(Math.abs(back - s) <= Math.max(16, Math.abs(s) / 16), `${s} came back as ${back}`);
  }
});

test('24 kHz → 8 kHz keeps every sample across odd-sized chunks', () => {
  const d = new Downsampler();
  const pcm = (n) => Buffer.alloc(n * 2);
  // 7 + 8 = 15 samples in → exactly 5 out, whatever the split.
  assert.equal(d.push(pcm(7)).length + d.push(pcm(8)).length, 5);
});

const listen = (server) => new Promise((r) => server.listen(0, () => r(server.address().port)));

test('a call: session, audio both ways, barge-in, finish_call, result, hang-up', async () => {
  // The functions: a session for the right key, and a place to post the result.
  const posted = [];
  const fns = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body || '{}');
    if (req.url === '/agentVoiceSession') {
      if (json.key !== 'k-123') return res.writeHead(403).end('{}');
      return res.end(JSON.stringify({ token: 'auth_tokens/abc', model: 'gemini-3.8-live', maxSeconds: 60 }));
    }
    posted.push({ url: req.url, json });
    res.end('{}');
  });
  const fnsPort = await listen(fns);

  // Gemini: greets, speaks, is interrupted, then finishes the call.
  const gemini = new WebSocketServer({ port: 0 });
  await once(gemini, 'listening');
  const seenByGemini = [];
  gemini.on('connection', (ws, req) => {
    assert.match(req.url, /access_token=auth_tokens%2Fabc/);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      seenByGemini.push(m);
      if (m.setup) ws.send(JSON.stringify({ setupComplete: {} }));
      if (m.realtimeInput?.text) {
        const audio = Buffer.alloc(24 * 2 * 20).toString('base64'); // 20 ms at 24 kHz
        ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: audio } }] }, outputTranscription: { text: 'Salam, ' } } }));
        ws.send(JSON.stringify({ serverContent: { outputTranscription: { text: 'main AI assistant hoon.' } } }));
      }
      if (m.realtimeInput?.audio) {
        assert.equal(m.realtimeInput.audio.mimeType, 'audio/pcm;rate=8000');
        ws.send(JSON.stringify({ serverContent: { interrupted: true, inputTranscription: { text: 'Haan bolien' } } }));
        ws.send(
          JSON.stringify({
            toolCall: { functionCalls: [{ id: 'f1', name: 'finish_call', args: { result: 'interested', summary: 'Wants details.', whatsapp_ok: true } }] },
          }),
        );
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
    });
  });

  const bridge = await startServer({
    port: 0,
    functionsUrl: `http://127.0.0.1:${fnsPort}`,
    geminiUrl: `ws://127.0.0.1:${gemini.address().port}`,
  });

  // Twilio.
  const twilio = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/stream`);
  await once(twilio, 'open');
  const toTwilio = [];
  twilio.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    toTwilio.push(m);
    // Twilio echoes a mark once everything before it has played.
    if (m.event === 'mark') twilio.send(JSON.stringify({ event: 'mark', streamSid: 'MZ1', mark: m.mark }));
  });
  twilio.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ1', customParameters: { callId: 'c1', wid: 'velocity', key: 'k-123' } } }));

  // Wait for the greeting, then talk over it for 100 ms.
  for (let i = 0; i < 50 && !toTwilio.some((m) => m.event === 'media'); i++) await new Promise((r) => setTimeout(r, 20));
  const frame = Buffer.alloc(160, 0xff).toString('base64');
  for (let i = 0; i < 5; i++) twilio.send(JSON.stringify({ event: 'media', streamSid: 'MZ1', media: { payload: frame } }));

  await once(twilio, 'close');
  for (let i = 0; i < 50 && !posted.length; i++) await new Promise((r) => setTimeout(r, 20));

  assert.ok(seenByGemini.some((m) => m.setup?.model === 'models/gemini-3.8-live'));
  const media = toTwilio.find((m) => m.event === 'media');
  assert.equal(media.streamSid, 'MZ1');
  assert.equal(Buffer.from(media.media.payload, 'base64').length, 160, '20 ms at 8 kHz');
  assert.ok(toTwilio.some((m) => m.event === 'clear'), 'barge-in clears what Twilio has buffered');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, '/agentVoiceResult');
  assert.equal(posted[0].json.result, 'interested');
  assert.equal(posted[0].json.whatsappOk, true);
  assert.deepEqual(posted[0].json.transcript, [
    { who: 'agent', text: 'Salam, main AI assistant hoon.' },
    { who: 'them', text: 'Haan bolien' },
  ]);

  bridge.close();
  gemini.close();
  fns.close();
});

test('a wrong key gets no voice and the call is closed', async () => {
  const posted = [];
  const fns = http.createServer(async (req, res) => {
    for await (const _ of req);
    if (req.url === '/agentVoiceSession') return res.writeHead(403).end('{}');
    posted.push(req.url);
    res.end('{}');
  });
  const fnsPort = await listen(fns);
  const bridge = await startServer({ port: 0, functionsUrl: `http://127.0.0.1:${fnsPort}`, geminiUrl: 'ws://127.0.0.1:9' });
  const twilio = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/stream`);
  await once(twilio, 'open');
  twilio.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ2', customParameters: { callId: 'c2', key: 'nope' } } }));
  await once(twilio, 'close');
  for (let i = 0; i < 50 && !posted.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(posted, ['/agentVoiceResult']);
  bridge.close();
  fns.close();
});
