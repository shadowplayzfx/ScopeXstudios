import React, { useState } from 'react';
import { Check, Copy, Download, Loader2, PenTool, Save } from 'lucide-react';
import { MarkdownView } from './MarkdownView';

interface WriterViewProps {
  topic: string;
  content: string;
  isLoading: boolean;
  error: string;
  onGenerateWriting: (params: {
    topic: string;
    format: string;
    tone: string;
    length: string;
  }) => Promise<void>;
  onSaveAsProject: (title: string, content: string) => void;
}

export const WriterView: React.FC<WriterViewProps> = ({
  topic: initialTopic,
  content,
  isLoading,
  error,
  onGenerateWriting,
  onSaveAsProject,
}) => {
  const [topic, setTopic] = useState(initialTopic || '');
  const [format, setFormat] = useState('article');
  const [tone, setTone] = useState('editorial');
  const [length, setLength] = useState('medium');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isLoading) return;
    await onGenerateWriting({ topic: topic.trim(), format, tone, length });
  };

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scopex-${format}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold text-white">
          AI Writer Studio
        </h2>
        <p className="text-xs text-slate-400">
          Craft articles, stories, executive emails, reports, and scripts with full tone and format control.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="article">Article / Essay</option>
              <option value="story">Short Story</option>
              <option value="email">Professional Email</option>
              <option value="report">Executive Report</option>
              <option value="script">Video / Film Script</option>
              <option value="creative">Creative Copy</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="editorial">Editorial & Thoughtful</option>
              <option value="executive">Executive & Concise</option>
              <option value="cinematic">Cinematic & Vivid</option>
              <option value="technical">Technical & Precise</option>
              <option value="conversational">Warm & Conversational</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Length</label>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value)}
              className="w-full bg-[#07090E] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="short">Concise (~300 words)</option>
              <option value="medium">Standard (~700 words)</option>
              <option value="long">Long-Form (~1,400 words)</option>
            </select>
          </div>
        </div>

        <textarea
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Describe what you want written (audience, key points, call to action, or plot premise)..."
          className="w-full bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-xl p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none resize-none"
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isLoading || !topic.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Drafting...
              </>
            ) : (
              <>
                <PenTool className="w-4 h-4" />
                Generate Draft
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
          {error}
        </div>
      )}

      {content && (
        <div className="bg-[#0D1119] border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <span className="text-xs text-slate-400">
              {format} · {tone} · {content.split(/\s+/).length} words
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => onSaveAsProject(topic || 'Writer Draft', content)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
              >
                <Save className="w-3.5 h-3.5" />
                Save Project
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          </div>
          <MarkdownView content={content} />
        </div>
      )}
    </div>
  );
};
