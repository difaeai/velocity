import React, { useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEnter } from '../anim';
import Avatar from '../components/Avatar';
import Backdrop from '../components/Backdrop';
import { GoogleMark } from '../components/BrandMarks';
import Glass from '../components/Glass';
import { C, R, TOP_INSET } from '../theme';

const OTP_LENGTH = 6;
const FIGURE = require('../../assets/vexa.png');

export default function AuthScreen({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const hidden = useRef<TextInput>(null);

  const head = useEnter(40, { y: 18 });
  const body = useEnter(160, { y: 18 });

  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => code[i] ?? '');
  const canSend = phone.replace(/\D/g, '').length >= 10;

  return (
    <View style={st.root}>
      <Backdrop />

      <Image source={FIGURE} style={st.figure} resizeMode="contain" />

      <Animated.View style={[st.head, head]}>
        <Avatar size={84} online={false} />
        <Text style={st.title}>
          Welcome to VE<Text style={{ color: C.lime }}>X</Text>A
        </Text>
        <Text style={st.sub}>
          {sent ? 'Enter the code we sent you.' : 'Sign in and your team starts tonight.'}
        </Text>
      </Animated.View>

      <Animated.View style={[st.body, body]}>
        {sent ? (
          <>
            <Pressable onPress={() => hidden.current?.focus()} style={st.otpRow}>
              {digits.map((d, i) => (
                <Glass key={i} style={st.otpBox} radius={14} lit={i === code.length}>
                  <Text style={st.otpText}>{d}</Text>
                </Glass>
              ))}
            </Pressable>

            <TextInput
              ref={hidden}
              style={st.hidden}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
            />

            <Text style={st.sentTo}>Sent to +92 {phone || '3xx xxx xxxx'}</Text>

            <Pressable onPress={onDone} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}>
              <Text style={st.ctaText}>Verify &amp; continue</Text>
            </Pressable>

            <View style={st.linkRow}>
              <Text style={st.muted}>Resend in 0:29</Text>
              <Pressable onPress={() => setSent(false)} hitSlop={8}>
                <Text style={st.link}>Change number</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Glass style={st.google} radius={R.pill} onPress={onDone}>
              <View style={st.googleInner}>
                <GoogleMark size={20} />
                <Text style={st.googleText}>Continue with Google</Text>
              </View>
            </Glass>

            <View style={st.orRow}>
              <View style={st.rule} />
              <Text style={st.or}>or</Text>
              <View style={st.rule} />
            </View>

            <Glass style={st.phone} radius={R.lg}>
              <View style={st.phoneInner}>
                <View style={st.cc}>
                  <Text style={st.ccText}>+92</Text>
                </View>
                <TextInput
                  style={st.phoneInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="3xx xxx xxxx"
                  placeholderTextColor={C.textFaint}
                  keyboardType="phone-pad"
                />
              </View>
            </Glass>

            <Pressable
              onPress={() => setSent(true)}
              style={({ pressed }) => [st.cta, !canSend && st.ctaOff, pressed && { opacity: 0.85 }]}
            >
              <Text style={st.ctaText}>Send code</Text>
            </Pressable>

            <Text style={st.terms}>
              By continuing you agree to the Terms and the Privacy Policy.
            </Text>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  // Whole cut-out on screen, tucked into the bottom-right corner.
  figure: { position: 'absolute', right: 4, bottom: 0, width: 264, height: 264, opacity: 0.85 },

  head: { alignItems: 'center', marginTop: TOP_INSET + 40 },
  title: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 1, marginTop: 18 },
  sub: { color: C.textDim, fontSize: 13.5, marginTop: 8 },

  body: { paddingHorizontal: 24, marginTop: 40 },

  google: {},
  googleInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 },
  googleText: { color: C.text, fontSize: 15, fontWeight: '700' },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  rule: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  or: { color: C.textFaint, fontSize: 12.5 },

  phone: {},
  phoneInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 10 },
  cc: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ccText: { color: C.text, fontSize: 15, fontWeight: '800' },
  phoneInput: { flex: 1, color: C.text, fontSize: 16, letterSpacing: 1, paddingVertical: 8 },

  cta: {
    marginTop: 18,
    backgroundColor: C.lime,
    borderRadius: R.pill,
    alignItems: 'center',
    paddingVertical: 16,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { color: '#0A1206', fontSize: 15.5, fontWeight: '800' },

  terms: { color: C.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 18, lineHeight: 17 },

  otpRow: { flexDirection: 'row', gap: 9, justifyContent: 'center' },
  otpBox: { width: 48, height: 58, alignItems: 'center', justifyContent: 'center' },
  otpText: { color: C.text, fontSize: 22, fontWeight: '800' },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  sentTo: { color: C.textDim, fontSize: 13, textAlign: 'center', marginTop: 18 },

  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  muted: { color: C.textFaint, fontSize: 12.5 },
  link: { color: C.lime, fontSize: 12.5, fontWeight: '700' },
});
