'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export default function InterviewChatPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用 ref 持有 abort controller，cleanup 时 abort 流
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // cleanup：组件 unmount 时 abort in-flight fetch + reader
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  async function send() {
    if (!input.trim() || streaming || finished) return;
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const r = await fetch(`/api/interview/${params.id}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error?.message || '发送失败，请稍后重试');
        setStreaming(false);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      let buf = '';

      setMessages((m) => [...m, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith(':')) continue; // SSE heartbeat / comment
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            setFinished(true);
            setStreaming(false);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(parsed.error.message || '流式错误');
              continue;
            }
            if (parsed.content) {
              acc += parsed.content;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: 'assistant', content: acc };
                return copy;
              });
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
      // 流末尾 flush 残留 buf（防御性）
      if (buf.trim()) {
        const rest = buf.trim();
        if (rest.startsWith('data:') && rest.slice(5).trim() !== '[DONE]') {
          try {
            const parsed = JSON.parse(rest.slice(5).trim());
            if (parsed.content) acc += parsed.content;
          } catch {
            /* ignore */
          }
        }
      }
      setStreaming(false);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // 静默退出（cleanup）
      setError((e as Error).message);
      setStreaming(false);
    } finally {
      abortRef.current = null;
    }
  }

  async function finish() {
    setFinished(true);
    try {
      // Bug-028 (2026-07-20 E2E)：调 /complete 端点触发 status=COMPLETED + 评分持久化
      const r = await fetch(`/api/interview/${params.id}/complete`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error?.message || '完成面试失败');
        setFinished(false);
        return;
      }
    } catch (e) {
      setError((e as Error).message || '网络错误');
      setFinished(false);
      return;
    }
    router.push(`/interview/${params.id}/report` as never);
  }

  return (
    <main className="min-h-screen flex flex-col max-w-3xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">面试进行中</h1>
        <button
          onClick={finish}
          disabled={streaming && !messages.length}
          className="btn-secondary text-sm"
        >
          结束并查看报告
        </button>
      </div>

      {/* a11y: SSE 流式消息区宣读（屏读用户能感知 AI 输出） */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        aria-label="面试对话"
        className="flex-1 overflow-y-auto space-y-3 mb-4 p-4 bg-gray-50 rounded-lg"
      >
        {messages.length === 0 && <p className="text-gray-400 text-center">面试官即将开始提问…</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-white border'
              }`}
            >
              {m.content ||
                (streaming && i === messages.length - 1 ? (
                  <span aria-label="AI 正在输入">…</span>
                ) : (
                  ''
                ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-red-500 text-sm mb-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          disabled={streaming || finished}
          placeholder="输入你的回答…"
          aria-label="回答输入框"
          className="input flex-1"
          maxLength={2000}
        />
        <button
          onClick={send}
          disabled={streaming || finished || !input.trim()}
          className="btn-primary"
        >
          发送
        </button>
      </div>
    </main>
  );
}
