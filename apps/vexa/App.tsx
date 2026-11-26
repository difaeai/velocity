import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useEnter } from './src/anim';
import AppShell from './src/screens/AppShell';
import AuthScreen from './src/screens/AuthScreen';
import SplashScreen from './src/screens/SplashScreen';
import StoryScreen from './src/screens/StoryScreen';
import { C } from './src/theme';

type Stage = 'splash' | 'story' | 'auth' | 'app';

/** Every stage change is one cross-fade; remounting on the key starts it. */
function Fade({ children }: { children: React.ReactNode }) {
  const enter = useEnter(0, { y: 0, duration: 420 });
  return <Animated.View style={[styles.fill, enter]}>{children}</Animated.View>;
}

export default function App() {
  const [stage, setStage] = useState<Stage>('splash');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Fade key={stage}>
        {stage === 'splash' ? <SplashScreen onDone={() => setStage('story')} /> : null}
        {stage === 'story' ? <StoryScreen onDone={() => setStage('auth')} /> : null}
        {stage === 'auth' ? <AuthScreen onDone={() => setStage('app')} /> : null}
        {stage === 'app' ? <AppShell onLogout={() => setStage('auth')} /> : null}
      </Fade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
});
