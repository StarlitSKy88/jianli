'use client';
import { useState } from 'react';

interface UploadResult {
  id: string;
  name: string;
  parsed: { name?: string; skills?: string[]; yearsOfExperience?: number };
}

export function ResumeUploader({ onUploaded }: { onUploaded: (r: UploadResult) => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    setProgress('上传中…');

    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/resume/upload', { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || '上传失败');
        return;
      }
      setProgress('解析中（AI 提取字段）…');
      const d = await r.json();
      onUploaded(d.resume);
      setProgress('✓ 完成');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      }}
      className={`p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition ${
        dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
      onClick={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp';
        input.onchange = () => {
          const f = input.files?.[0];
          if (f) handleFile(f);
        };
        input.click();
      }}
    >
      {uploading ? (
        <p className="text-gray-600">{progress}</p>
      ) : (
        <>
          <p className="text-lg mb-2">📄 拖拽简历到这里，或点击上传</p>
          <p className="text-sm text-gray-500">
            支持 PDF / Word / TXT / Markdown / 图片（OCR）— 最大 5MB
          </p>
        </>
      )}
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}
