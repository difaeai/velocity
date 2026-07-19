/**
 * Language-aware drop-in replacements for react-native's <Text> and <TextInput>.
 *
 * Screens import these instead of the react-native originals:
 *
 *   import { Text } from '../../src/ui/Text';
 *
 * …and every string they render is looked up in the Urdu dictionary. This keeps
 * the ~1,200 UI labels in the app translatable without threading a t() call
 * through each one, and it makes the admin boundary structural rather than
 * conditional: admin screens keep importing Text from react-native, so no admin
 * label can ever be translated by accident.
 *
 * Only literal string children are translated. Interpolated values (names,
 * addresses, amounts) pass through untouched, and nested <Text> elements
 * translate themselves on their own render.
 */
import { isValidElement, type Ref, type ReactNode } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { isUrdu, t } from '../i18n';

/** Translate the string leaves of a children tree, leaving elements alone. */
function translateChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return t(children);
  if (typeof children === 'number' || children == null || typeof children === 'boolean') {
    return children;
  }
  // Plain .map, not Children.map: Children.map rewrites the keys of element
  // children, which would change reconciliation for any list rendered inside a
  // <Text>. Mapping directly hands React the exact same elements it saw before.
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === 'string' ? t(child) : child));
  }
  // A single element child renders (and translates) itself.
  if (isValidElement(children)) return children;
  return children;
}

export function Text({ children, ref, ...rest }: TextProps & { ref?: Ref<RNText> }) {
  return (
    <RNText {...rest} ref={ref}>
      {isUrdu() ? translateChildren(children) : children}
    </RNText>
  );
}

/**
 * Callers do `useRef<TextInput>(null)`, so the name has to be a type as well as
 * a value. An interface (not a type alias) is what allows that merge with the
 * function declaration below.
 */
export interface TextInput extends RNTextInput {}

export function TextInput({
  placeholder,
  ref,
  ...rest
}: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return (
    <RNTextInput
      {...rest}
      ref={ref}
      placeholder={placeholder != null && isUrdu() ? t(placeholder) : placeholder}
    />
  );
}
