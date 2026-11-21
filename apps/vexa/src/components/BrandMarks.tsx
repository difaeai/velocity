import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// Simplified platform marks, drawn so the mock needs no image files.
type P = { size?: number };
const box = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24' });

export const GoogleMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <Path
      d="M21.6 12.2c0-.7-.06-1.3-.18-1.9H12v3.6h5.3a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3.1-4.3 3.1-7.2Z"
      fill="#4285F4"
    />
    <Path
      d="M12 22c2.7 0 5-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
      fill="#34A853"
    />
    <Path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2Z" fill="#FBBC05" />
    <Path
      d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 2.9 14.7 2 12 2a10 10 0 0 0-8.9 5.4L6.4 10c.8-2.4 3-4.1 5.6-4.1Z"
      fill="#EA4335"
    />
  </Svg>
);

export const InstagramMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.6" stroke="#E4405F" strokeWidth={2} fill="none" />
    <Circle cx="12" cy="12" r="4.4" stroke="#E4405F" strokeWidth={2} fill="none" />
    <Circle cx="17.3" cy="6.7" r="1.3" fill="#F77737" />
  </Svg>
);

export const MetaMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <Path
      d="M8.2 8.2c2.6 0 3.3 7.6 7.6 7.6 2.1 0 3.2-1.7 3.2-3.8s-1.1-3.8-3.2-3.8c-4.3 0-5 7.6-7.6 7.6C6.1 15.8 5 14.1 5 12s1.1-3.8 3.2-3.8Z"
      stroke="#0866FF"
      strokeWidth={2.1}
      strokeLinecap="round"
      fill="none"
    />
  </Svg>
);

export const YoutubeMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="1.8" y="5" width="20.4" height="14" rx="4.4" fill="#FF0000" />
    <Path d="M10 8.8 16 12l-6 3.2Z" fill="#FFFFFF" />
  </Svg>
);

const TIKTOK_NOTE =
  'M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.7a5.7 5.7 0 1 0 4.9 5.6V9.4a7.3 7.3 0 0 0 4.3 1.4V7.7a4.3 4.3 0 0 1-3.3-1.9Z';

export const TiktokMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <G translateX={-1.2}>
      <Path d={TIKTOK_NOTE} fill="#25F4EE" />
    </G>
    <G translateX={1.2}>
      <Path d={TIKTOK_NOTE} fill="#FE2C55" />
    </G>
    <Path d={TIKTOK_NOTE} fill="#FFFFFF" />
  </Svg>
);

export const WhatsappMark = ({ size = 18 }: P) => (
  <Svg {...box(size)} fill="none">
    <Path
      d="M12 2.6a9.3 9.3 0 0 0-8 14.1L2.6 21.4l4.8-1.3A9.3 9.3 0 1 0 12 2.6Z"
      fill="#25D366"
    />
    <Path
      d="M8.9 7.4c.3 0 .5.1.7.5l.7 1.5c.1.3.1.5-.1.7l-.5.6c-.2.2-.2.4-.1.6a6.4 6.4 0 0 0 3 2.9c.2.1.4.1.6-.1l.6-.6c.2-.2.4-.2.7-.1l1.6.7c.4.2.5.4.5.7 0 1.1-1 1.9-2.1 1.9-2.8 0-6.7-3.8-6.7-6.6 0-1.1.9-2.1 2-2.1Z"
      fill="#FFFFFF"
    />
  </Svg>
);
