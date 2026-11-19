import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Presentation,
  Save,
} from 'lucide-react';
import type { GeneratedDocument } from '../types/studio';
import { MarkdownView } from './MarkdownView';

interface DocumentStudioViewProps {
  activeDoc: GeneratedDocument | null;
  isLoading: boolean;
  error: string;
  onGenerateDocument: (params: {
    topic: string;
    kind: 'presentation' | 'document';
    slideCount: number;
  }) => Promise<void>;
  onSaveAsProject: (doc: GeneratedDocument) => void;
}

export const DocumentStudioView: React.FC<DocumentStudioViewProps> = ({
  activeDoc,
  isLoading,
  error,
  onGenerateDocument,
  onSaveAsProject,
}) => {
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'presentation' | 'document'>('presentation');
  const [slideCount, setSlideCount] = useState(7);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isLoading) return;
    setActiveSlideIdx(0);
    await onGenerateDocument({ topic: topic.trim(), kind, slideCount });
  };

  const handleDownloadPdf = () => {
    if (!activeDoc) return;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const margin = 48;
    const maxW = pageW - margin * 2;
    let y = 64;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    const titleLines = pdf.splitTextToSize(activeDoc.title, maxW) as string[];
    pdf.text(titleLines, margin, y);
    y += titleLines.length * 24 + 6;

    if (activeDoc.subtitle) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(100, 116, 139);
      const subLines = pdf.splitTextToSize(activeDoc.subtitle, maxW) as string[];
      pdf.text(subLines, margin, y);
      y += subLines.length * 16 + 18;
    }

    pdf.setTextColor(15, 23, 42);

    if (activeDoc.kind === 'presentation' && activeDoc.slides.length > 0) {
      for (let i = 0; i < activeDoc.slides.length; i++) {
        const slide = activeDoc.slides[i];
        if (i > 0) {
          pdf.addPage();
          y = 64;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        const sTitle = pdf.splitTextToSize(`${i + 1}. ${slide.title}`, maxW) as string[];
        pdf.text(sTitle, margin, y);
        y += sTitle.length * 22 + 14;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(12);
        for (const bullet of slide.bullets) {
          const bLines = pdf.splitTextToSize(`• ${bullet}`, maxW - 12) as string[];
          pdf.text(bLines, margin + 8, y);
          y += bLines.length * 16 + 8;
        }

        if (slide.speakerNotes) {
          y += 12;
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(10);
          pdf.setTextColor(100, 116, 139);
          const nLines = pdf.splitTextToSize(
            `Speaker Notes: ${slide.speakerNotes}`,
            maxW
          ) as string[];
          pdf.text(nLines, margin, y);
          pdf.setTextColor(15, 23, 42);
        }
      }
    } else {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      const plain = activeDoc.content.replace(/[#*`]/g, '');
      const lines = pdf.splitTextToSize(plain, maxW) as string[];
      for (const line of lines) {
        if (y > pdf.internal.pageSize.getHeight() - 54) {
          pdf.addPage();
          y = 54;
        }
        pdf.text(line, margin, y);
        y += 15;
      }
    }

    pdf.save(
      `${activeDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'scopex-document'}.pdf`
    );
  };

  const slides = activeDoc?.slides || [];
  const currentSlide = slides[activeSlideIdx] || slides[0];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold text-white">
          AI Document & Presentation Studio
        </h2>
        <p className="text-xs text-slate-400">
          Generate interactive presentation decks and structured documents with direct PDF export.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0D1119] border border-white/10 rounded-xl p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#07090E] border border-white/10 rounded-lg">
            <button
              type="button"
              onClick={() => setKind('presentation')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                kind === 'presentation'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Presentation className="w-3.5 h-3.5" />
              Presentation Deck
            </button>
            <button
              type="button"
              onClick={() => setKind('document')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                kind === 'document'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Structured PDF Report
            </button>
          </div>

          {kind === 'presentation' && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              Slides:
              <select
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
                className="bg-[#07090E] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white"
              >
                <option value={5}>5 slides</option>
                <option value={7}>7 slides</option>
                <option value={10}>10 slides</option>
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Describe your presentation or document (e.g., Artificial intelligence in modern healthcare)..."
            className="flex-1 bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !topic.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Generate'
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
          {error}
        </div>
      )}

      {activeDoc && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold text-white">
                {activeDoc.title}
              </h3>
              <p className="text-xs text-slate-400">{activeDoc.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSaveAsProject(activeDoc)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200"
              >
                <Save className="w-3.5 h-3.5" />
                Save Project
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            </div>
          </div>

          {activeDoc.kind === 'presentation' && slides.length > 0 && currentSlide ? (
            <div className="space-y-4">
              {/* Interactive Slide Stage */}
              <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#0D1320] via-[#090D16] to-[#111022] border border-white/15 rounded-2xl p-8 md:p-12 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
                  <span>{activeDoc.title}</span>
                  <span>
                    Slide {activeSlideIdx + 1} / {slides.length}
                  </span>
                </div>

                <div className="space-y-6 my-auto">
                  <h4 className="font-display text-2xl md:text-3xl font-bold text-white">
                    {currentSlide.title}
                  </h4>
                  <ul className="space-y-3">
                    {currentSlide.bullets.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 text-sm md:text-base text-slate-200"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {currentSlide.speakerNotes && (
                  <div className="pt-4 border-t border-white/[0.08] text-xs text-slate-400">
                    Notes: {currentSlide.speakerNotes}
                  </div>
                )}
              </div>

              {/* Slide Controls */}
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  disabled={activeSlideIdx === 0}
                  onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0D1119] border border-white/10 disabled:opacity-40 text-xs text-slate-200"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous Slide
                </button>
                <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                  {slides.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveSlideIdx(idx)}
                      className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums transition-colors ${
                        idx === activeSlideIdx
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#0D1119] text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={activeSlideIdx >= slides.length - 1}
                  onClick={() =>
                    setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0D1119] border border-white/10 disabled:opacity-40 text-xs text-slate-200"
                >
                  Next Slide
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#0D1119] border border-white/10 rounded-xl p-6">
              <MarkdownView content={activeDoc.content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
