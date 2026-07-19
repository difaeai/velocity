/**
 * Emoji picker — a compact sliding sheet of common emojis for the chat
 * composer, plus the quick-reaction row used when long-pressing a message.
 *
 * Pure JS (no native module), so it works on the current build immediately.
 */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../config';
import { themed } from '../theme';

/** Emojis offered as one-tap message reactions (WhatsApp-style). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

/** Curated emoji set for the composer keyboard. */
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊',
  '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
  '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄',
  '😬', '😮‍💨', '😌', '😔', '😴', '😪', '🤤', '😷', '🤒', '🤕', '🤧', '🥵',
  '🥶', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮',
  '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱',
  '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '👍',
  '👎', '👌', '🤌', '✌️', '🤞', '🫰', '🤟', '🤙', '👈', '👉', '👆', '👇',
  '☝️', '👋', '🤚', '🖐️', '✋', '🙏', '🤝', '💪', '👏', '🙌', '🫶', '❤️',
  '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥', '💯', '🔥', '⭐',
  '✨', '🎉', '🎊', '🥂', '☕', '🍔', '🍕', '🚗', '🏍️', '🚕', '📍', '🗺️',
  '⏰', '✅', '❌', '❓', '❗', '💤', '👀', '🎁', '💸', '🤑', '👑', '🌙',
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <View style={s.wrap}>
      <FlatList
        data={EMOJIS}
        keyExtractor={(e, i) => `${e}-${i}`}
        numColumns={8}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.grid}
        renderItem={({ item }) => (
          <Pressable style={s.cell} onPress={() => onPick(item)} hitSlop={4}>
            <Text style={s.emoji}>{item}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  wrap:  { height: 220, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  grid:  { padding: 8 },
  cell:  { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', maxWidth: `${100 / 8}%` },
  emoji: { fontSize: 26 },
}));
