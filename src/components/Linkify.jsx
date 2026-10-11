// 遇到全形標點即結束網址；結尾的半形標點也不算進網址
const STOP = `\\s<>"'「」『』（）【】《》，。！？；：、`;
const URL_RE = new RegExp(`((?:https?://|www\\.)[^${STOP}]*[^${STOP}.,;:!?)\\]}])`, 'gi');

export default function Linkify({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={/^www\./i.test(part) ? `https://${part}` : part}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-600 dark:text-indigo-400 dark:decoration-indigo-700"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
