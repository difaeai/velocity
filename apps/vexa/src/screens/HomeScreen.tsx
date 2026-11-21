import React, { useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEnter } from '../anim';
import { GoogleMark, InstagramMark, MetaMark, TiktokMark, YoutubeMark } from '../components/BrandMarks';
import Glass from '../components/Glass';
import {
  BarsIcon,
  BoltIcon,
  CardIcon,
  ChartUpIcon,
  ChevronRight,
  DocPenIcon,
  MegaphoneIcon,
  RobotIcon,
  SendIcon,
  SparkleIcon,
  UsersIcon,
} from '../components/Icons';
import VexaStage from '../components/VexaStage';
import { C, R } from '../theme';

function Tile({
  icon,
  label,
  style,
  delay,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  style: object;
  delay: number;
  onPress: () => void;
}) {
  const enter = useEnter(delay, { y: 0, scale: 0.78 });
  return (
    <Animated.View style={[st.tileWrap, style, enter]}>
      <Glass style={st.tile} radius={R.lg} onPress={onPress}>
        <View style={st.tileInner}>
          {icon}
          <Text style={st.tileLabel}>{label}</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

function Chip({
  icon,
  label,
  delay,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  delay: number;
  onPress: () => void;
}) {
  const enter = useEnter(delay, { y: 10 });
  return (
    <Animated.View style={enter}>
      <Glass style={st.chip} radius={R.pill} onPress={onPress}>
        <View style={st.chipInner}>
          {icon}
          <Text style={st.chipLabel}>{label}</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

export default function HomeScreen({
  onOpen,
  onGoal,
}: {
  onOpen: (title: string) => void;
  onGoal: (text: string) => void;
}) {
  const [goalText, setGoalText] = useState('');
  const welcome = useEnter(60);
  const heading = useEnter(140);
  const orb = useEnter(480, { y: 0, scale: 0.78 });
  const goal = useEnter(620);

  return (
    <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
      <Animated.View style={welcome}>
        <Glass style={st.welcome} radius={R.lg} onPress={() => onOpen('Your business')}>
          <View style={st.welcomeInner}>
            <View style={st.welcomeIcon}>
              <SparkleIcon size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.welcomeTitle}>Welcome back, Hassan Zahir!</Text>
              <Text style={st.welcomeSub}>Let&apos;s grow your business with VEXA.</Text>
            </View>
            <ChevronRight size={20} />
          </View>
        </Glass>
      </Animated.View>

      <Animated.View style={heading}>
        <Text style={st.h1}>
          Tell me,<Text style={st.h1Dim}> what do you</Text>
        </Text>
        <Text style={st.h1Accent}>want?</Text>
      </Animated.View>

      <View style={st.stage}>
        <VexaStage />

        <Tile
          icon={<RobotIcon size={26} />}
          label={'Research\nAgent'}
          style={{ left: '1%', top: '2%' }}
          delay={240}
          onPress={() => onOpen('Research Agent')}
        />
        <Tile
          icon={<DocPenIcon size={26} />}
          label={'Content\nAgent'}
          style={{ right: '1%', top: '2%' }}
          delay={300}
          onPress={() => onOpen('Content Agent')}
        />
        <Tile
          icon={<MegaphoneIcon size={26} />}
          label={'Ads\nAgent'}
          style={{ left: 0, top: '33%' }}
          delay={360}
          onPress={() => onOpen('Ads Agent')}
        />
        <Tile
          icon={<ChartUpIcon size={26} />}
          label={'Sales\nAgent'}
          style={{ right: 0, top: '33%' }}
          delay={420}
          onPress={() => onOpen('Sales Agent')}
        />

        <Animated.View style={[st.orbWrap, orb]}>
          <Glass style={st.orb} radius={56} onPress={() => onOpen('Connected Accounts')}>
            <View style={st.orbInner}>
              <View style={st.orbRow}>
                <InstagramMark size={19} />
                <GoogleMark size={23} />
                <MetaMark size={21} />
              </View>
              <View style={st.orbRow}>
                <YoutubeMark size={19} />
                <TiktokMark size={18} />
              </View>
              <Text style={st.orbLabel}>{'Connected\nAccounts'}</Text>
            </View>
          </Glass>
        </Animated.View>

        <Tile
          icon={<CardIcon size={26} />}
          label="Subscription"
          style={{ right: '1%', top: '66%' }}
          delay={540}
          onPress={() => onOpen('Subscription')}
        />
      </View>

      <Animated.View style={goal}>
        <Glass style={st.goalCard} radius={R.xl} lit>
          <View style={st.goalInner}>
            <View style={{ flex: 1 }}>
              <View style={st.goalHead}>
                <SparkleIcon size={18} />
                <Text style={st.goalTitle}>Share your goal with VEXA</Text>
              </View>
              <TextInput
                style={st.goalInput}
                placeholder={'e.g. I want to increase my sales by 30%,\nor automate my content strategy...'}
                placeholderTextColor={C.textFaint}
                multiline
                value={goalText}
                onChangeText={setGoalText}
              />
            </View>
            <Pressable
              testID="goal-send"
              onPress={() => onGoal(goalText)}
              style={({ pressed }) => [st.sendBtn, pressed && { opacity: 0.85 }]}
            >
              <SendIcon size={24} />
            </Pressable>
          </View>
        </Glass>
      </Animated.View>

      <View style={st.chipRow}>
        <Chip
          icon={<BarsIcon size={15} />}
          label="Grow my audience"
          delay={700}
          onPress={() => setGoalText('I want to grow my audience on Instagram and TikTok.')}
        />
        <Chip
          icon={<UsersIcon size={15} />}
          label="Get more leads"
          delay={760}
          onPress={() => setGoalText('I want more enquiries from Lahore without spending more.')}
        />
        <Chip
          icon={<BoltIcon size={15} />}
          label="Automate tasks"
          delay={820}
          onPress={() => setGoalText('Take the posting and the replies off my hands.')}
        />
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 18 },

  welcome: { marginTop: 4 },
  welcomeInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  welcomeIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(120,255,140,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: { color: C.text, fontSize: 14.5, fontWeight: '700' },
  welcomeSub: { color: C.textDim, fontSize: 12.5, marginTop: 2 },

  h1: { color: C.text, fontSize: 27, fontWeight: '800', textAlign: 'center', marginTop: 22 },
  h1Dim: { color: '#A9B5AE', fontWeight: '600' },
  h1Accent: { color: C.lime, fontSize: 34, fontWeight: '900', textAlign: 'center', marginTop: 2 },

  stage: { height: 380, marginTop: 4 },
  tileWrap: { position: 'absolute', width: 96, height: 88 },
  tile: { width: '100%', height: '100%' },
  tileInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7 },
  tileLabel: { color: C.text, fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 15 },

  orbWrap: { position: 'absolute', left: '2%', top: '62%', width: 112, height: 112 },
  orb: { width: '100%', height: '100%' },
  orbInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  orbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orbLabel: { color: C.text, fontSize: 10.5, fontWeight: '600', textAlign: 'center', lineHeight: 13, marginTop: 2 },

  goalCard: { marginTop: 10 },
  goalInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  goalInput: { color: C.text, fontSize: 12.5, lineHeight: 18, marginTop: 8, padding: 0, minHeight: 38 },
  sendBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.lime,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 6,
    borderColor: 'rgba(195,255,55,0.18)',
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 14, justifyContent: 'center' },
  chip: {},
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 9 },
  chipLabel: { color: C.text, fontSize: 11, fontWeight: '600' },
});
