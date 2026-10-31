import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'velocity.draft.';

/**
 * A text field that survives the app being closed, a crash or a sign-in that
 * ended: what was typed is kept on the phone until `clear()` — call it once the
 * work is sent. Storage failing makes it an ordinary field, never an error.
 */
export function useDraft(key: string, initial = ''): [string, (v: string) => void, () => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    AsyncStorage.getItem(PREFIX + key)
      .then((saved) => {
        if (saved) setValue(saved);
      })
      .catch(() => {});
  }, [key]);

  const set = useCallback(
    (v: string) => {
      setValue(v);
      (v ? AsyncStorage.setItem(PREFIX + key, v) : AsyncStorage.removeItem(PREFIX + key)).catch(() => {});
    },
    [key],
  );

  const clear = useCallback(() => set(''), [set]);
  return [value, set, clear];
}
