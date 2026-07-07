// Custom app entry.
//
// Why this exists instead of the default `expo-router/entry`:
// every screen builds its StyleSheet from the shared `colors` object at module
// load time. expo-router eagerly imports all route screens the moment the
// router mounts — which happens BEFORE an async read of the saved theme can
// finish. The result is that screens bake the default (dark) palette and the
// saved light theme never visually applies.
//
// Fix: register a tiny gate component synchronously (so native finds "main"),
// read the saved theme, apply it to `colors`, and ONLY THEN require the router
// (`qualified-entry`) — which is the thing that pulls in every screen. By that
// point `colors` already holds the correct palette, so styles bake correctly.
import '@expo/metro-runtime';
import React from 'react';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyTheme, normalizeMode, THEME_STORAGE_KEY } from './src/theme';

function Root() {
  const [App, setApp] = React.useState(null);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        applyTheme(normalizeMode(saved));
      } catch {
        applyTheme('dark');
      }
      // Requiring the router here (after the theme is applied) is what imports
      // every route screen, so their StyleSheets pick up the correct palette.
      const mod = require('expo-router/build/qualified-entry');
      if (mounted) setApp(() => mod.App);
    })();
    return () => { mounted = false; };
  }, []);

  return App ? React.createElement(App) : null;
}

renderRootComponent(Root);
