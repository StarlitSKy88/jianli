'use client';
/**
 * TurnstileWidget — Cloudflare Turnstile 客户端组件
 *
 * 行为：
 * - 自动加载 https://challenges.cloudflare.com/turnstile/v0/api.js
 * - 用 explicit render（更可控，cleanup 干净）
 * - onSuccess(token) 把 token 传给父组件
 * - onError / onExpire 让父组件清空 token
 *
 * 设计：
 * - dev 环境 NEXT_PUBLIC_TURNSTILE_SITE_KEY 缺失 → 不渲染（生产 backend 会跳过验证）
 * - 卸载时 remove(widgetId) + remove(script)，防止 HMR 多实例泄漏
 */
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

export interface TurnstileWidgetProps {
  onSuccess: (token: string) => void;
  onError?: (code?: string) => void;
  onExpire?: () => void;
  className?: string;
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export function TurnstileWidget({ onSuccess, onError, onExpire, className }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onExpireRef = useRef(onExpire);
  const [enabled, setEnabled] = useState(false);

  // 保持 ref 最新，避免 useEffect 重跑
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
    onExpireRef.current = onExpire;
  }, [onSuccess, onError, onExpire]);

  useEffect(() => {
    // dev 环境没配 site key → 不渲染（避免 console 报错）
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) return;
    setEnabled(true);

    let script: HTMLScriptElement | null = null;
    let cancelled = false;

    function tryRender() {
      if (cancelled) return;
      if (!window.turnstile || !containerRef.current) return;
      // 避免重复渲染（HMR 或 StrictMode 双调用）
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => onSuccessRef.current(token),
        'error-callback': (code?: string) => onErrorRef.current?.(code),
        'expired-callback': () => onExpireRef.current?.(),
      });
    }

    // 如果脚本已经存在（多组件共用），直接 render
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    if (existing) {
      if (window.turnstile) tryRender();
      else existing.addEventListener('load', tryRender);
      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }

    script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.onload = tryRender;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      // 不删 script：可能被其他组件复用
    };
  }, []);

  if (!enabled) return null;
  return <div ref={containerRef} className={className} />;
}
