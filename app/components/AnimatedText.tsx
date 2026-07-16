/**
 * AnimatedText — Phase 15.5 Prisma 风格文本动画
 *
 * 纯 CSS 实现，无 framer-motion 依赖（避免增加 bundle 大小）。
 * 使用 CSS keyframes + animation-delay 实现词级 / 字符级错落入场。
 *
 * ⚠️ 'use client' 必需：
 * ScrollFadeChars 使用 IntersectionObserver（useEffect），
 * WordsPullUp 自身纯 CSS 但 Next.js 要求客户端组件必须显式标记。
 */

'use client';

import React from 'react';

interface WordsPullUpProps {
  text: string;
  className?: string;
  /** 每个词之间的延迟（毫秒） */
  delay?: number;
  /** 起始延迟 */
  startDelay?: number;
  /** 使用斜体（Instrument Serif） */
  italic?: boolean;
}

/**
 * 词级逐词上拉动画 — Prisma spec 同款
 * 每个词延迟 100ms 依次出现
 */
export function WordsPullUp({
  text,
  className = '',
  delay = 100,
  startDelay = 0,
  italic = false,
}: WordsPullUpProps) {
  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((word, i) => (
        <span
          key={i}
          className={`word-pull-up ${italic ? 'font-serif-italic' : ''}`}
          style={{ animationDelay: `${startDelay + i * delay}ms` }}
        >
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

interface ScrollFadeCharsProps {
  text: string;
  className?: string;
}

/**
 * 字符级滚动淡入 — About 段叙事
 * 初始 opacity 0.15，IntersectionObserver 触发后变 1
 */
export function ScrollFadeChars({ text, className = '' }: ScrollFadeCharsProps) {
  // SSR-safe：使用 ref + useEffect 绑定 IntersectionObserver
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // 将文本拆成字符（保留空格）
  const chars = Array.from(text);
  return (
    <span ref={containerRef} className={className}>
      {chars.map((ch, i) => (
        <span
          key={i}
          className={`scroll-fade-char ${visible ? 'is-visible' : ''}`}
          style={{ transitionDelay: `${i * 12}ms` }}
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}
