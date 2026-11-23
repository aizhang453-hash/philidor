// 好坏的小图标 (自己画的): 圆底, 中间是符号。
import type { Cls } from "./review";

export const CLS_COLOR: Record<Cls, string> = {
  brilliant: "#1fa79f",
  great: "#5b8bb4",
  best: "#7fb04a",
  excellent: "#7fb04a",
  good: "#93b57a",
  book: "#a5845f",
  inaccuracy: "#e8b938",
  mistake: "#e8902f",
  miss: "#e5604c",
  blunder: "#c93a2e",
};

const TEXT: Partial<Record<Cls, string>> = {
  brilliant: "!!",
  great: "!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

function Glyph({ cls }: { cls: Cls }) {
  const t = TEXT[cls];
  if (t)
    return (
      <text x="12" y="16.6" textAnchor="middle" fontSize={t.length > 1 ? 12 : 14} fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">
        {t}
      </text>
    );
  switch (cls) {
    case "best":
      return <path d="M12 5.2l2.05 4.3 4.7.6-3.45 3.25.88 4.65L12 15.75 7.82 18l.88-4.65L5.25 10.1l4.7-.6z" fill="#fff" />;
    case "excellent":
      return (
        <path
          d="M7 11h2.2v6.6H7zM10.2 17.6V11l2.6-4.4c.9-.4 1.8.2 1.7 1.2l-.5 2.4h3.3c.9 0 1.5.8 1.3 1.6l-1.2 4.6c-.2.7-.8 1.2-1.5 1.2z"
          fill="#fff"
        />
      );
    case "good":
      return <path d="M6.6 12.4l3.6 3.5 7.2-7.4" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "book":
      return (
        <path
          d="M5.5 7.6c2.2-.6 4.4-.3 6.1 1v8.6c-1.7-1.2-3.9-1.5-6.1-.9zM18.5 7.6c-2.2-.6-4.4-.3-6.1 1v8.6c1.7-1.2 3.9-1.5 6.1-.9z"
          fill="#fff"
        />
      );
    case "miss":
      return <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />;
    default:
      return null;
  }
}

export function ClsIcon({ cls, size = 18, title }: { cls: Cls; size?: number; title?: string }) {
  return (
    <svg className="cls-icon" width={size} height={size} viewBox="0 0 24 24" aria-label={title}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="11" fill={CLS_COLOR[cls]} />
      <Glyph cls={cls} />
    </svg>
  );
}
