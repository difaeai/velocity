import React from 'react';
import Svg, { Circle, Ellipse, Path, Polyline, Rect } from 'react-native-svg';
import { C } from '../theme';

type P = { size?: number; color?: string };
const box = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24' });
const line = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export const GridIcon = ({ size = 22, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="3" y="3" width="7.5" height="7.5" rx="2.2" {...line(color)} />
    <Rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2" {...line(color)} />
    <Rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2" {...line(color)} />
    <Rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.2" {...line(color)} />
  </Svg>
);

export const BellIcon = ({ size = 22, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" {...line(color)} />
    <Path d="M13.7 19a2 2 0 0 1-3.4 0" {...line(color)} />
  </Svg>
);

export const SparkleIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 2.5 13.9 9.4 20.8 11.3 13.9 13.2 12 20.1 10.1 13.2 3.2 11.3 10.1 9.4Z" fill={color} />
    <Path d="M18.6 3 19.4 5.4 21.8 6.2 19.4 7 18.6 9.4 17.8 7 15.4 6.2 17.8 5.4Z" fill={color} opacity={0.7} />
  </Svg>
);

export const ChevronRight = ({ size = 20, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Polyline points="9,4.5 16.5,12 9,19.5" {...line(color)} />
  </Svg>
);

export const ChevronsLeft = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Polyline points="12.5,6 6.5,12 12.5,18" {...line(color)} />
    <Polyline points="18.5,6 12.5,12 18.5,18" {...line(color)} />
  </Svg>
);

export const RobotIcon = ({ size = 24, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 2.9v2.6" {...line(color)} />
    <Circle cx="12" cy="2" r="1.1" fill={color} />
    <Rect x="3.5" y="5.5" width="17" height="13" rx="4.5" {...line(color)} />
    <Circle cx="8.8" cy="11.6" r="1.6" fill={color} />
    <Circle cx="15.2" cy="11.6" r="1.6" fill={color} />
    <Path d="M9.5 15.4h5" {...line(color)} />
    <Path d="M2 10.5v3.2M22 10.5v3.2" {...line(color)} />
  </Svg>
);

export const DocPenIcon = ({ size = 24, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M14.5 2.6H6.4A2.4 2.4 0 0 0 4 5v14a2.4 2.4 0 0 0 2.4 2.4h7.2" {...line(color)} />
    <Path d="M14.5 2.6 19.6 7.7v3" {...line(color)} />
    <Path d="M7.6 8.4h5.2M7.6 12h5.2M7.6 15.6h3.4" {...line(color)} />
    <Path d="M21.2 12.6 15.9 17.9l-.5 2.8 2.8-.5 5.3-5.3a1.5 1.5 0 0 0-2.3-2.3Z" {...line(color)} />
  </Svg>
);

export const MegaphoneIcon = ({ size = 24, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M3 10.2v3.6a1.8 1.8 0 0 0 1.8 1.8h2L13 20V4L6.8 8.4h-2A1.8 1.8 0 0 0 3 10.2Z" {...line(color)} />
    <Path d="M16.4 8.6a4.6 4.6 0 0 1 0 6.8" {...line(color)} />
    <Path d="M19.3 6a8.2 8.2 0 0 1 0 12" {...line(color)} />
    <Path d="M7.2 16v3.4a1.6 1.6 0 0 0 3.2 0v-1.6" {...line(color)} />
  </Svg>
);

export const ChartUpIcon = ({ size = 24, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M4 20.4h16" {...line(color)} />
    <Rect x="5" y="13" width="3.2" height="5.4" rx="1.2" fill={color} />
    <Rect x="10.4" y="10" width="3.2" height="8.4" rx="1.2" fill={color} opacity={0.8} />
    <Rect x="15.8" y="6.4" width="3.2" height="12" rx="1.2" fill={color} opacity={0.6} />
    <Path d="M5 9.4 10 5.6l3.6 2.6L20.2 3.2" {...line(color)} />
    <Path d="M16.4 3.2h3.9v3.9" {...line(color)} />
  </Svg>
);

export const CardIcon = ({ size = 24, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="2.5" y="5.5" width="19" height="13" rx="3.2" {...line(color)} />
    <Path d="M2.5 10h19" {...line(color)} />
    <Rect x="5.5" y="12.8" width="4.6" height="3" rx="1" fill={color} />
  </Svg>
);

export const SendIcon = ({ size = 24, color = '#0A1206' }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M21 3 3.4 10.1l6.7 2.3L13 21Z" fill={color} />
  </Svg>
);

export const BarsIcon = ({ size = 18, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="3.5" y="12.5" width="4" height="7.5" rx="1.4" fill={color} />
    <Rect x="10" y="8" width="4" height="12" rx="1.4" fill={color} />
    <Rect x="16.5" y="4" width="4" height="16" rx="1.4" fill={color} />
  </Svg>
);

export const UsersIcon = ({ size = 18, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="9" cy="8" r="3.4" fill={color} />
    <Path d="M2.8 19.4c0-3.2 2.8-5.2 6.2-5.2s6.2 2 6.2 5.2Z" fill={color} />
    <Circle cx="17.4" cy="8.8" r="2.6" fill={color} opacity={0.7} />
    <Path d="M16 13.6c3.2-.5 5.6 1.4 5.6 4.4h-4.2c0-1.7-.5-3.2-1.4-4.4Z" fill={color} opacity={0.7} />
  </Svg>
);

export const BoltIcon = ({ size = 18, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M13.4 2 4.6 13.4h5.6L10.2 22l9-11.6h-5.8Z" fill={color} />
  </Svg>
);

export const HomeIcon = ({ size = 22, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M3.6 10.4 12 3.4l8.4 7v9.2a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4Z" fill={color} />
  </Svg>
);

export const ActivityIcon = ({ size = 22, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Polyline points="2.5,12 7,12 9.5,5 14,19 16.5,12 21.5,12" {...line(color)} />
  </Svg>
);

export const ContentIcon = ({ size = 22, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="2.8" y="4.5" width="18.4" height="15" rx="5" {...line(color)} />
    <Path d="M10.2 9.2 15 12l-4.8 2.8Z" fill={color} />
  </Svg>
);

export const PersonIcon = ({ size = 22, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="12" cy="8" r="3.9" {...line(color)} />
    <Path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" {...line(color)} />
  </Svg>
);

export const SearchIcon = ({ size = 22, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="10.8" cy="10.8" r="6.6" {...line(color)} />
    <Path d="M15.8 15.8 21 21" {...line(color)} />
  </Svg>
);

export const DocIcon = ({ size = 22, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="4.5" y="2.8" width="15" height="18.4" rx="3" {...line(color)} />
    <Path d="M8.2 8h7.6M8.2 12h7.6M8.2 16h4.6" {...line(color)} />
  </Svg>
);

export const CrownIcon = ({ size = 18, color = '#F5C13B' }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M2.6 7.4 6.6 11 12 4.6 17.4 11l4-3.6-1.7 10.4H4.3Z" fill={color} />
    <Path d="M4.3 19.8h15.4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

export const CheckCircleIcon = ({ size = 20, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="12" cy="12" r="9.4" fill={color} />
    <Polyline
      points="7.8,12.2 10.7,15.1 16.3,9.3"
      stroke="#04140B"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

export const ArrowUpIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 20V4.6" {...line(color)} />
    <Polyline points="5.6,11 12,4.6 18.4,11" {...line(color)} />
  </Svg>
);

export const LogoutIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M14.4 3.6H6.6A2.6 2.6 0 0 0 4 6.2v11.6a2.6 2.6 0 0 0 2.6 2.6h7.8" {...line(color)} />
    <Polyline points="16.6,8 20.6,12 16.6,16" {...line(color)} />
    <Path d="M20.6 12H10.2" {...line(color)} />
  </Svg>
);

export const CapIcon = ({ size = 22, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 3.4 22 8.2l-10 4.8L2 8.2Z" fill={color} />
    <Path d="M6.4 11v4.8c0 1.8 2.5 3.2 5.6 3.2s5.6-1.4 5.6-3.2V11" {...line(color)} />
    <Path d="M21 9v5.4" {...line(color)} />
  </Svg>
);

const GLOBE_NODES: Array<[number, number]> = [
  [50, 12],
  [78, 32],
  [80, 66],
  [50, 88],
  [22, 66],
  [20, 32],
  [50, 50],
  [36, 40],
  [64, 60],
];

export const GlobeWireIcon = ({ size = 72, color = C.green }: P) => (
  <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <Circle cx="50" cy="50" r="38" stroke={color} strokeWidth={1.2} opacity={0.75} fill="none" />
    <Ellipse cx="50" cy="50" rx="16" ry="38" stroke={color} strokeWidth={1} opacity={0.5} fill="none" />
    <Ellipse cx="50" cy="50" rx="31" ry="38" stroke={color} strokeWidth={1} opacity={0.35} fill="none" />
    <Ellipse cx="50" cy="50" rx="38" ry="15" stroke={color} strokeWidth={1} opacity={0.5} fill="none" />
    <Ellipse cx="50" cy="50" rx="38" ry="30" stroke={color} strokeWidth={1} opacity={0.3} fill="none" />
    {GLOBE_NODES.map(([x, y], i) => (
      <Circle key={i} cx={x} cy={y} r={2} fill={color} />
    ))}
  </Svg>
);

// ——— the rest of the set, used by the feature screens ———

export const PlusIcon = ({ size = 22, color = '#0A1206' }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 5.5v13M5.5 12h13" {...line(color)} strokeWidth={2.2} />
  </Svg>
);

export const CloseIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...line(color)} />
  </Svg>
);

export const CheckIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Polyline points="5,12.8 9.8,17.5 19,7" {...line(color)} strokeWidth={2.1} />
  </Svg>
);

export const PencilIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10v3Z" {...line(color)} />
    <Path d="M14.5 6.5l3 3" {...line(color)} />
  </Svg>
);

export const TrashIcon = ({ size = 20, color = '#FF7A7A' }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" {...line(color)} />
    <Path d="M6.5 7l.9 11.4A1.6 1.6 0 0 0 9 20h6a1.6 1.6 0 0 0 1.6-1.6L17.5 7" {...line(color)} />
    <Path d="M10.5 11v5M13.5 11v5" {...line(color)} />
  </Svg>
);

export const CopyIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="8.5" y="8.5" width="11" height="11" rx="2.4" {...line(color)} />
    <Path d="M15.5 5.5h-9A2 2 0 0 0 4.5 7.5v9" {...line(color)} />
  </Svg>
);

export const CalendarIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="3.5" y="5.5" width="17" height="15" rx="3" {...line(color)} />
    <Path d="M3.5 10h17M8.5 3.5v4M15.5 3.5v4" {...line(color)} />
  </Svg>
);

export const ClockIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="12" cy="12" r="8.5" {...line(color)} />
    <Polyline points="12,7 12,12 15.8,14" {...line(color)} />
  </Svg>
);

export const FilterIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M4 6.5h16M7 12h10M10 17.5h4" {...line(color)} />
  </Svg>
);

export const PlayIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M8.5 5.8l9.5 6.2-9.5 6.2V5.8Z" fill={color} />
  </Svg>
);

export const PauseIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="7" y="5.5" width="3.6" height="13" rx="1.3" fill={color} />
    <Rect x="13.4" y="5.5" width="3.6" height="13" rx="1.3" fill={color} />
  </Svg>
);

export const LinkIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M10 14a3.4 3.4 0 0 1 0-4.8l2.6-2.6a3.4 3.4 0 0 1 4.8 4.8L16 12.8" {...line(color)} />
    <Path d="M14 10a3.4 3.4 0 0 1 0 4.8l-2.6 2.6a3.4 3.4 0 0 1-4.8-4.8L8 11.2" {...line(color)} />
  </Svg>
);

export const ImageIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="3.5" y="4.5" width="17" height="15" rx="3" {...line(color)} />
    <Circle cx="9" cy="9.6" r="1.6" {...line(color)} />
    <Path d="M4.4 17.5l4.9-4.6a2 2 0 0 1 2.7 0l3.2 3 1.5-1.3a2 2 0 0 1 2.6 0l2.1 1.8" {...line(color)} />
  </Svg>
);

export const DownloadIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 4v10.5M7.8 10.6L12 15l4.2-4.4" {...line(color)} />
    <Path d="M4.5 18.5h15" {...line(color)} />
  </Svg>
);

export const RefreshIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M20 12a8 8 0 1 1-2.6-5.9" {...line(color)} />
    <Polyline points="20,3.6 20,7.4 16.2,7.4" {...line(color)} />
  </Svg>
);

export const WifiOffIcon = ({ size = 20, color = '#FFC24B' }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M3 8.5a15 15 0 0 1 7-3.3M21 8.5a15 15 0 0 0-4.6-2.9" {...line(color)} />
    <Path d="M6.6 12.3a10 10 0 0 1 3-1.8M17.4 12.3a10 10 0 0 0-2.2-1.5" {...line(color)} />
    <Path d="M10.1 15.8a5 5 0 0 1 3.8 0" {...line(color)} />
    <Circle cx="12" cy="19" r="1.2" fill={color} />
    <Path d="M3.4 3.4l17.2 17.2" {...line(color)} />
  </Svg>
);

export const ChevronDown = ({ size = 20, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Polyline points="6,9.5 12,15.5 18,9.5" {...line(color)} />
  </Svg>
);

export const StarIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8Z" fill={color} />
  </Svg>
);

export const MicIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Rect x="9" y="3" width="6" height="11" rx="3" {...line(color)} />
    <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" {...line(color)} />
  </Svg>
);

export const FolderIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M3.5 7.5a2 2 0 0 1 2-2h3.3l2 2.4h7.7a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" {...line(color)} />
  </Svg>
);

export const TargetIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="12" cy="12" r="8.4" {...line(color)} />
    <Circle cx="12" cy="12" r="4.4" {...line(color)} />
    <Circle cx="12" cy="12" r="1.3" fill={color} />
  </Svg>
);

export const EyeIcon = ({ size = 18, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12Z" {...line(color)} />
    <Circle cx="12" cy="12" r="2.8" {...line(color)} />
  </Svg>
);

export const HeartIcon = ({ size = 18, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 19.5S3.8 14.8 3.8 9.6A4.1 4.1 0 0 1 12 7.5a4.1 4.1 0 0 1 8.2 2.1c0 5.2-8.2 9.9-8.2 9.9Z" {...line(color)} />
  </Svg>
);

export const CommentIcon = ({ size = 18, color = C.textDim }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M20.5 11.5a7.6 7.6 0 0 1-11 6.8L4.5 19.5l1.3-4.6A7.6 7.6 0 1 1 20.5 11.5Z" {...line(color)} />
  </Svg>
);

export const PhoneIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path
      d="M7.4 3.6h2.1l1.3 3.4-1.8 1.4a10 10 0 0 0 4.6 4.6l1.4-1.8 3.4 1.3v2.1a2.2 2.2 0 0 1-2.4 2.2A14.4 14.4 0 0 1 5.2 6A2.2 2.2 0 0 1 7.4 3.6Z"
      {...line(color)}
    />
  </Svg>
);

export const NoteIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M6 3.5h9.5L19.5 7.5v13h-13V3.5Z" {...line(color)} />
    <Path d="M9.5 11h7M9.5 15h4.5" {...line(color)} />
  </Svg>
);

export const ShieldIcon = ({ size = 20, color = C.green }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 3.2l7 2.6v5.6c0 4.3-3 7.6-7 9.4-4-1.8-7-5.1-7-9.4V5.8Z" {...line(color)} />
    <Polyline points="8.8,12 11.2,14.4 15.4,9.8" {...line(color)} />
  </Svg>
);

export const BulbIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M12 3.2a5.6 5.6 0 0 1 3.4 10.1V16H8.6v-2.7A5.6 5.6 0 0 1 12 3.2Z" {...line(color)} />
    <Path d="M9.4 18.5h5.2M10.4 21h3.2" {...line(color)} />
  </Svg>
);

export const PlugIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Path d="M9 3.5v5M15 3.5v5" {...line(color)} />
    <Path d="M6.5 8.5h11v2.6a5.5 5.5 0 0 1-11 0V8.5Z" {...line(color)} />
    <Path d="M12 16.6V21" {...line(color)} />
  </Svg>
);

export const CoinIcon = ({ size = 20, color = C.lime }: P) => (
  <Svg {...box(size)} fill="none">
    <Ellipse cx="12" cy="7" rx="7.5" ry="3.2" {...line(color)} />
    <Path d="M4.5 7v5c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V7" {...line(color)} />
    <Path d="M4.5 12v4.2c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V12" {...line(color)} />
  </Svg>
);

export const GlobeIcon = ({ size = 20, color = C.text }: P) => (
  <Svg {...box(size)} fill="none">
    <Circle cx="12" cy="12" r="8.5" {...line(color)} />
    <Ellipse cx="12" cy="12" rx="3.6" ry="8.5" {...line(color)} />
    <Path d="M3.6 9.4h16.8M3.6 14.6h16.8" {...line(color)} />
  </Svg>
);
