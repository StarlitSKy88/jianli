/**
 * 首页 — Phase 15.5 Prisma 风格
 *
 * 三段式布局（参考 Prisma studio landing page spec）：
 *  1. Hero — 巨型 "Interview Buddy" 标题 + Instrument Serif 斜体强调
 *  2. About — 访谈式叙事 + 关键句斜体 + scroll-fade-char 字符级淡入
 *  3. Features — 4 卡片网格 + card-rise 动画 + 内联 SVG 图标
 *
 * 设计语言：dark moody (#0a0a0a/#101010/#212121) + warm cream (#DEDBC8)
 * + Almarai 字体全局 + Instrument Serif 斜体衬线
 *
 * 约束：
 *  - 纯 CSS 动画（无 framer-motion 依赖，避免 bundle 膨胀）
 *  - 内联 SVG 图标（无 lucide-react 依赖）
 *  - 128MiB build 容量警报（Phase 14.22 教训）
 */

import Link from 'next/link';
import { WordsPullUp, ScrollFadeChars } from '@/app/components/AnimatedText';
import { MicIcon, RadarIcon, SparkleIcon, GiftIcon, ConcentricRings } from '@/app/components/icons';

export default function HomePage() {
  return (
    <main className="bg-[#0a0a0a] text-[#DEDBC8] overflow-hidden">
      {/* ========== HERO ========== */}
      <section className="relative min-h-screen flex items-center justify-center px-6 py-24 noise-overlay">
        {/* 背景装饰：慢速旋转同心圆 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <ConcentricRings size={680} />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          {/* 顶部 eyebrow */}
          <div className="mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DEDBC8]/20 bg-[#DEDBC8]/5">
            <span className="w-2 h-2 rounded-full bg-[#DEDBC8] animate-pulse" />
            <span className="text-xs tracking-[0.2em] uppercase text-[#DEDBC8]/70">
              AI 面试陪练 · 35+ 群体
            </span>
          </div>

          {/* 主标题 — Prisma 风格巨字 + 斜体强调 */}
          <h1 className="font-extrabold tracking-tight leading-[0.95] mb-8">
            <WordsPullUp
              text="Interview"
              className="block text-[clamp(3.5rem,12vw,9rem)] text-[#DEDBC8]"
              delay={120}
              startDelay={100}
            />
            <WordsPullUp
              text="Buddy."
              className="block text-[clamp(3.5rem,12vw,9rem)] font-serif-italic font-normal text-[#E1E0CC]"
              delay={120}
              startDelay={500}
            />
          </h1>

          {/* 副标题 */}
          <p className="text-lg md:text-xl text-[#DEDBC8]/70 max-w-2xl mx-auto mb-12 leading-relaxed">
            <WordsPullUp
              text="字节 · 阿里 · 腾讯 · B 站 — 16 关真实模拟，让 35+ 的你重新被看见"
              className="block"
              delay={40}
              startDelay={900}
            />
          </p>

          {/* CTA 双按钮 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/login" className="btn-primary text-base">
              开始面试
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link href="/register" className="btn-secondary text-base">
              注册账号
            </Link>
          </div>

          {/* 滚动指示 */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[#DEDBC8]/40 text-xs tracking-[0.3em] uppercase animate-pulse">
            Scroll
          </div>
        </div>
      </section>

      {/* ========== ABOUT ========== */}
      <section className="relative px-6 py-32 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto">
          {/* 段标签 */}
          <div className="mb-12 flex items-center gap-4">
            <span className="text-xs tracking-[0.3em] uppercase text-[#DEDBC8]/50">About</span>
            <span className="flex-1 h-px bg-[#DEDBC8]/20" />
          </div>

          {/* 大段叙事 */}
          <div className="space-y-8 text-2xl md:text-4xl leading-relaxed font-light">
            <p className="text-[#DEDBC8]/90">
              我们见过太多
              <span className="font-serif-italic text-[#E1E0CC]">35 岁的工程师</span>
              ，简历石沉大海、面试屡屡碰壁。
            </p>
            <p className="text-[#DEDBC8]/90">
              他们不是不够强，只是被
              <span className="font-serif-italic text-[#E1E0CC]">年龄偏见</span>和
              <span className="font-serif-italic text-[#E1E0CC]">表达惯性</span>
              反复消磨。
            </p>
            <p>
              <ScrollFadeChars text="所以我们做了 Interview Buddy — 一对一还原字节、阿里、腾讯、B 站的真实面试节奏，8 个维度精准打分，让每一次练习都算数。" />
            </p>
          </div>

          {/* 数字统计 */}
          <div className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { num: '16', label: '真实关卡' },
              { num: '8', label: '评分维度' },
              { num: '4', label: '互联网大厂' },
              { num: '3', label: '每日免费次数' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="card-rise border-t border-[#DEDBC8]/20 pt-6"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="text-5xl md:text-6xl font-extrabold text-[#DEDBC8] mb-2">
                  {stat.num}
                </div>
                <div className="text-sm text-[#DEDBC8]/50 tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section className="relative px-6 py-32 bg-[#101010] noise-overlay">
        <div className="max-w-6xl mx-auto">
          {/* 段标签 */}
          <div className="mb-16 flex items-center gap-4">
            <span className="text-xs tracking-[0.3em] uppercase text-[#DEDBC8]/50">Features</span>
            <span className="flex-1 h-px bg-[#DEDBC8]/20" />
          </div>

          <h2 className="text-4xl md:text-6xl font-extrabold mb-16 leading-tight max-w-3xl">
            不只是模拟，
            <span className="font-serif-italic font-normal text-[#E1E0CC]">而是进化</span>。
          </h2>

          {/* 4 卡片网格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              icon={<MicIcon />}
              title="真实模拟"
              subtitle="Real Interview"
              description="字节 / 阿里 / 腾讯 / B 站 — 16 关覆盖算法、系统设计、项目深挖、文化匹配。每家公司独立 Prompt，独立评分权重。"
              delay={0}
            />
            <FeatureCard
              icon={<RadarIcon />}
              title="8 维度评分"
              subtitle="8 Dimensions"
              description="技术深度 · 系统设计 · 算法 · 计算机基础 · 项目经验 · 文化匹配 · STAR 结构 · 抗压能力 — 不只是'答得对不对'。"
              delay={120}
            />
            <FeatureCard
              icon={<SparkleIcon />}
              title="AI 教练陪练"
              subtitle="AI Coach"
              description="回答后即时生成追问与反馈。每一次练习都会自动识别薄弱环节，下一关针对性强化。"
              delay={240}
            />
            <FeatureCard
              icon={<GiftIcon />}
              title="每日 3 免费"
              subtitle="Daily Free"
              description="不需要信用卡，注册即送。超出后 ¥9.9 / 次 — 比一杯咖啡便宜，比一次失败面试便宜太多。"
              delay={360}
            />
          </div>

          {/* 底部 CTA */}
          <div className="mt-24 text-center">
            <p className="text-[#DEDBC8]/60 mb-6 text-lg">准备好让 35+ 的自己重新被看见？</p>
            <Link href="/register" className="btn-primary text-base">
              立即开始
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ========== BOTTOM TAGLINE ========== */}
      <section className="relative px-6 py-32 bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="font-serif-italic text-3xl md:text-5xl text-[#E1E0CC] leading-snug">
            "年龄不是边界，
            <br />
            表达才是。"
          </p>
          <p className="mt-8 text-sm text-[#DEDBC8]/40 tracking-[0.2em] uppercase">
            Interview Buddy · 2026
          </p>
        </div>
      </section>
    </main>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  delay: number;
}

function FeatureCard({ icon, title, subtitle, description, delay }: FeatureCardProps) {
  return (
    <div
      className="card-rise group relative p-8 rounded-2xl bg-[#212121] border border-[#DEDBC8]/10 hover:border-[#DEDBC8]/30 transition-all duration-500 hover:-translate-y-1"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* 图标 */}
      <div className="mb-6 inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#DEDBC8]/10 text-[#DEDBC8] group-hover:bg-[#DEDBC8] group-hover:text-black transition-colors duration-500">
        {icon}
      </div>

      {/* 副标题 */}
      <div className="text-xs tracking-[0.2em] uppercase text-[#DEDBC8]/40 mb-2">{subtitle}</div>

      {/* 主标题 */}
      <h3 className="text-2xl font-bold mb-4 text-[#DEDBC8]">{title}</h3>

      {/* 描述 */}
      <p className="text-[#DEDBC8]/60 leading-relaxed">{description}</p>

      {/* 装饰 — 角落小圆点 */}
      <div className="absolute top-6 right-6 w-1.5 h-1.5 rounded-full bg-[#DEDBC8]/30 group-hover:bg-[#DEDBC8] transition-colors duration-500" />
    </div>
  );
}
