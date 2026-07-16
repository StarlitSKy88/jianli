/**
 * 内联 SVG 图标 — Phase 15.5 Prisma 风格
 *
 * 不依赖 lucide-react（避免新增 bundle）。
 * stroke-width 1.5 + 圆形端点，匹配 Prisma spec 的极简线条美学。
 */

import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const baseProps = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

/** 真实模拟 — 麦克风 */
export const MicIcon = ({ size = 28, ...rest }: IconProps) => (
  <svg {...baseProps(size)} {...rest}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
    <path d="M8 22h8" />
  </svg>
);

/** 8 维度评分 — 雷达 / 圆形图表 */
export const RadarIcon = ({ size = 28, ...rest }: IconProps) => (
  <svg {...baseProps(size)} {...rest}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <path d="M5.6 5.6l12.8 12.8" />
    <path d="M18.4 5.6L5.6 18.4" />
  </svg>
);

/** AI 教练 — 闪光 / 星星 */
export const SparkleIcon = ({ size = 28, ...rest }: IconProps) => (
  <svg {...baseProps(size)} {...rest}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z" />
    <path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5L5 4Z" />
  </svg>
);

/** 每日 3 免费 — 礼物 / 太阳 */
export const GiftIcon = ({ size = 28, ...rest }: IconProps) => (
  <svg {...baseProps(size)} {...rest}>
    <path d="M20 12v9H4v-9" />
    <path d="M2 7h20v5H2z" />
    <path d="M12 21V7" />
    <path d="M12 7H8a2 2 0 1 1 0-4c2 0 4 3 4 4Z" />
    <path d="M12 7h4a2 2 0 1 0 0-4c-2 0-4 3-4 4Z" />
  </svg>
);

/** 装饰 — 旋转的同心圆 */
export const ConcentricRings = ({ size = 480, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 480 480"
    fill="none"
    className="slow-rotate"
    {...rest}
  >
    <circle cx="240" cy="240" r="200" stroke="#DEDBC8" strokeWidth="0.5" opacity="0.15" />
    <circle cx="240" cy="240" r="160" stroke="#DEDBC8" strokeWidth="0.5" opacity="0.2" />
    <circle cx="240" cy="240" r="120" stroke="#DEDBC8" strokeWidth="0.5" opacity="0.25" />
    <circle cx="240" cy="240" r="80" stroke="#DEDBC8" strokeWidth="0.5" opacity="0.3" />
    <circle cx="240" cy="240" r="40" stroke="#DEDBC8" strokeWidth="0.5" opacity="0.4" />
  </svg>
);
