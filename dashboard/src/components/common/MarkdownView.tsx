// dashboard/src/components/common/MarkdownView.tsx
import React from 'react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * Parses inline markdown: bold (**text**), italic (*text* or _text_), inline code (`code`)
 */
function renderInline(text: string, keyPrefix = 'inline'): React.ReactNode {
  // Regex matches:
  // 1. **bold**
  // 2. `code`
  // 3. *italic* or _italic_
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={key} className="font-bold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={key} className="px-1.5 py-0.5 rounded bg-black/40 border border-gray-800 font-mono text-amber-300 text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      (part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length >= 2)
    ) {
      return (
        <em key={key} className="italic text-gray-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  if (!content || typeof content !== 'string') return null;

  // Split into raw lines
  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code blocks (```lang ... ```)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <div key={`codeblock-${i}`} className="my-2 rounded-xl bg-black/60 border border-gray-850 p-3 font-mono text-[11px] text-amber-300/90 overflow-x-auto shadow-inner">
          {lang && <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold block mb-1">{lang}</span>}
          <pre className="whitespace-pre">{codeLines.join('\n')}</pre>
        </div>
      );
      continue;
    }

    // 2. Empty line (Paragraph spacer)
    if (!trimmed) {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // 3. Blockquotes (> ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="my-2 border-l-2 border-amber-500/80 bg-amber-950/20 pl-3 py-1.5 rounded-r-xl italic text-amber-200/90 text-xs space-y-1"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInline(ql, `q-${i}-${qIdx}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 4. Headings (#, ##, ###, ####)
    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        if (level === 1) {
          elements.push(
            <h2 key={`h1-${i}`} className="text-base font-black text-white mt-3 mb-1 border-b border-gray-800 pb-1">
              {renderInline(text, `h1-${i}`)}
            </h2>
          );
        } else if (level === 2) {
          elements.push(
            <h3 key={`h2-${i}`} className="text-sm font-extrabold text-amber-300 mt-2.5 mb-1">
              {renderInline(text, `h2-${i}`)}
            </h3>
          );
        } else if (level === 3) {
          elements.push(
            <h4 key={`h3-${i}`} className="text-xs font-bold text-amber-400 mt-2 mb-0.5">
              {renderInline(text, `h3-${i}`)}
            </h4>
          );
        } else {
          elements.push(
            <h5 key={`h4-${i}`} className="text-xs font-semibold text-gray-200 mt-1.5 mb-0.5">
              {renderInline(text, `h4-${i}`)}
            </h5>
          );
        }
        i++;
        continue;
      }
    }

    // 5. Horizontal divider (---, ***, ___)
    if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-gray-800/80" />);
      i++;
      continue;
    }

    // 6. Bullet lists (- item, * item)
    if (/^[-*+]\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 space-y-1 list-none pl-1">
          {listItems.map((li, lIdx) => (
            <li key={lIdx} className="flex items-start gap-2 text-xs text-gray-300">
              <span className="text-amber-400 font-bold select-none leading-relaxed">•</span>
              <span className="flex-1 min-w-0 leading-relaxed">{renderInline(li, `li-${i}-${lIdx}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 7. Numbered lists (1. item, 2. item)
    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: { num: string; text: string }[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const m = lines[i].trim().match(/^(\d+)\.\s+(.*)$/);
        if (m) {
          listItems.push({ num: m[1], text: m[2] });
        }
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 space-y-1 list-none pl-1">
          {listItems.map((li, lIdx) => (
            <li key={lIdx} className="flex items-start gap-2 text-xs text-gray-300">
              <span className="text-amber-400 font-mono text-[11px] font-bold select-none leading-relaxed shrink-0">
                {li.num}.
              </span>
              <span className="flex-1 min-w-0 leading-relaxed">{renderInline(li.text, `oli-${i}-${lIdx}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 8. Regular paragraph line
    elements.push(
      <p key={`p-${i}`} className="text-xs leading-relaxed">
        {renderInline(line, `p-${i}`)}
      </p>
    );
    i++;
  }

  return <div className={`space-y-0.5 leading-relaxed ${className}`}>{elements}</div>;
};

export default MarkdownView;
