"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";



type Mode = "explain" | "quiz" | "practice";

type HistoryItem = {
  id: string;
  createdAt: number;
  mode: Mode;
  notes: string;
  output: string;
};


const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: "explain", label: "Explain", desc: "Step-by-step explanation + examples" },
  { id: "quiz", label: "Quiz", desc: "MCQ + short answer + answer key" },
  { id: "practice", label: "Practice", desc: "5 problems (easy → hard) + solutions" },
];

export default function Home() {
  const [notes, setNotes] = useState("");
  const [output, setOutput] = useState("");
  const [mode, setMode] = useState<Mode>("explain");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const HISTORY_KEY = "ai_study_assistant_history_v1";
  const [focusOutput, setFocusOutput] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");
  const [scanProgress, setScanProgress] = useState<number>(0);




  const charCount = notes.length;

  const placeholder = useMemo(() => {
    if (mode === "explain") return "Paste your notes… (e.g., derivative rules, chem concepts, etc.)";
    if (mode === "quiz") return "Paste notes… I’ll turn them into a quiz with answers.";
    return "Paste notes… I’ll generate practice problems with solutions.";
  }, [mode]);

    useEffect(() => {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw));
    } catch {
        // ignore
    }
    }, []);

    useEffect(() => {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
        // ignore
    }
    }, [history]);


async function extractTextFromPdf(file: File) {
  // Dynamically import pdfjs ONLY in the browser
const pdfjsLib = await import("pdfjs-dist");
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";


  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const strings = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .filter(Boolean);

    fullText += strings.join(" ") + "\n\n";
  }

  return fullText.trim();
}



async function ocrPdfToText(file: File) {
  // 1) Dynamically import browser-only libs
  const pdfjsLib = await import("pdfjs-dist");
  const { createWorker } = await import("tesseract.js");

  // 2) Use your local worker file for PDF.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  // 3) Load PDF
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  // 4) Start OCR worker (English by default; can add others)
  const worker = await createWorker("eng");

  let fullText = "";

  try {
    // OCR all pages with a time estimate
const totalPages = pdf.numPages;
setScanProgress(0);

for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
  setScanStatus(`Image scanning page ${pageNum} / ${totalPages}…`);
  setScanProgress(Math.round(((pageNum - 1) / totalPages) * 100));

  const page = await pdf.getPage(pageNum);

  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  if (!ctx) continue;

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const dataUrl = canvas.toDataURL("image/png");
  const result = await worker.recognize(dataUrl);

  fullText += (result.data.text || "") + "\n\n";
}

setScanProgress(100);
setScanStatus("Image scanning complete.");

  } finally {
    await worker.terminate();
  }

  return fullText.trim();
}



function estimateScanTime(numPages: number) {
  // Rough estimate: 6–10 seconds per page depending on hardware & PDF complexity.
  // We’ll use 8 sec/page as a middle estimate + 10 sec overhead.
  const seconds = numPages * 8 + 10;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { seconds, minutes };
}


async function getPdfPageCount(file: File) {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  return pdf.numPages;
}







async function handleFileUpload(file: File) {
  setError("");

  const name = file.name.toLowerCase();

  // -------- TXT FILES --------
  if (name.endsWith(".txt")) {
    const text = await file.text();
    setNotes(text);
    return;
  }

  // -------- PDF FILES --------
  if (name.endsWith(".pdf")) {
    setLoading(true);
    setOutput("");
    setError("");
    setScanStatus("");
    setScanProgress(0);

    try {
      // 1) Try normal text extraction first
      const text = await extractTextFromPdf(file);

      // 2) If text is too short, assume scanned PDF → image scanning
      if (!text || text.length < 50) {
        // Get page count for time estimate
        const pages = await getPdfPageCount(file);

        // Rough estimate: ~8 sec per page + overhead
        const estSeconds = pages * 8 + 10;
        const estMinutes = Math.max(1, Math.round(estSeconds / 60));

        setScanStatus(
          `Scanned PDF detected — starting image scanning (~${estMinutes} min)…`
        );

        // IMPORTANT: this must be your actual scanning function name
        const scannedText = await ocrPdfToText(file);

        setNotes(scannedText);
        return;
      }

      // 3) Normal selectable-text PDF
      setNotes(text);
      return;
    } catch (e: any) {
      setError(e?.message || "Failed to read PDF.");
      return;
    } finally {
      setLoading(false);
      setScanStatus("");
      setScanProgress(0);
    }
  }

  // -------- UNSUPPORTED FILE --------
  setError("Please upload a .txt or .pdf file.");
}



  async function handleRun() {
    setLoading(true);
    setError("");
    setOutput("");

    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, mode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        return;
      }

      setOutput(data.result);

      const item: HistoryItem = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    mode,
    notes,
    output: data.result,
    };

// newest first, keep last 20
setHistory((prev) => [item, ...prev].slice(0, 20));

    } catch (e: any) {
      setError(e?.message || "Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-zinc-100">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        {/* Header */}
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-sm text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Local MVP • Study Assistant
          </div>

          <h1 className="mt-4 text-3xl md:text-4xl font-bold tracking-tight">
            AI Study Assistant - Jaidon Prakash
          </h1>
          <p className="mt-2 text-zinc-300 max-w-2xl">
            Paste your notes, choose a mode, and generate explanations, quizzes, or practice problems.
          </p>
        </header>

        {/* Two-column layout */}
        <div className={focusOutput ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 lg:grid-cols-2 gap-6"}>

          {/* Left: Input Card */}
          <section className={[
                    "rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-sm",
                    focusOutput ? "hidden lg:hidden" : ""
                    ].join(" ")}>

            <div className="p-5 border-b border-zinc-800">
              <h2 className="text-lg font-semibold">Input</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Tip: include definitions, formulas, and a small example if you have one.
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Mode selector */}
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={[
                      "rounded-xl border px-3 py-2 text-left transition",
                      mode === m.id
                        ? "border-zinc-600 bg-zinc-800"
                        : "border-zinc-800 bg-zinc-950/30 hover:bg-zinc-900/60",
                    ].join(" ")}
                  >
                    <div className="font-semibold">{m.label}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Notes textarea */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-zinc-200">Your notes</label>
                  <span className="text-xs text-zinc-400">{charCount} chars</span>
                </div>

                <textarea
                  className="w-full h-56 resize-none rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder={placeholder}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Minimum: 10 characters. Your key stays on the server (not in the browser).
                </p>
                {scanStatus && (
  <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm text-zinc-200">
    <div className="flex items-center justify-between gap-3">
      <span>{scanStatus}</span>
      <span className="text-xs text-zinc-400">{scanProgress}%</span>
    </div>
    <div className="mt-2 h-2 w-full rounded bg-zinc-800 overflow-hidden">
      <div
        className="h-full bg-emerald-500"
        style={{ width: `${scanProgress}%` }}
      />
    </div>
  </div>
)}

              </div>

                <div className="flex items-center gap-3">
                <label className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60 transition cursor-pointer">
                 Import .txt / .pdf
                <input
                type="file"
                accept=".txt,.pdf"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                    e.currentTarget.value = ""; // allow re-upload same file
                }}
                />
            </label>
    </div>


              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRun}
                  disabled={loading || notes.trim().length < 10}
                  className={[
                    "inline-flex items-center justify-center rounded-xl px-4 py-2 font-semibold transition",
                    "bg-emerald-500 text-zinc-950 hover:bg-emerald-400",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {loading ? "Generating…" : "Run"}
                </button>

                <button
                  onClick={() => {
                    setNotes("");
                    setOutput("");
                    setError("");
                  }}
                  className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60 transition"
                >
                  Clear
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}
            </div>
          </section>

          {/* Right: Output Card */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-sm">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Output</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  Copy it into your notes or a Google Doc.
                </p>
              </div>

              <div className="flex items-center gap-2">
                    <button
                        onClick={() => setFocusOutput((v) => !v)}
                        className="rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60 transition"
                        title="Expand/collapse output"
                    >
                        {focusOutput ? "Show Input" : "Focus Output"}
                    </button>

                    <button
                        onClick={copyOutput}
                        disabled={!output}
                        className="rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Copy
                    </button>
                    </div>

            </div>

            <div className="p-5">
              <div
                    className={[
                                "rounded-xl border border-zinc-800 bg-zinc-950/30 p-4",
                                focusOutput ? "min-h-[70vh]" : "min-h-[420px]",
                            ].join(" ")}
                >

                {loading && !output ? (
                  <div className="text-zinc-300">
                    <div className="animate-pulse">
                      <div className="h-4 w-2/3 bg-zinc-800 rounded mb-3" />
                      <div className="h-4 w-5/6 bg-zinc-800 rounded mb-3" />
                      <div className="h-4 w-1/2 bg-zinc-800 rounded mb-3" />
                      <div className="h-4 w-3/4 bg-zinc-800 rounded mb-3" />
                    </div>
                    <p className="text-xs text-zinc-500 mt-4">
                      Generating output…
                    </p>
                  </div>
                ) : output ? (
<div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-6">
  <div className="max-w-none text-zinc-100">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100 mb-4 mt-2">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 mt-8 mb-3">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-xl font-semibold text-zinc-100 mt-6 mb-2">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-[15px] leading-7 text-zinc-100 my-3">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-6 my-4 space-y-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-6 my-4 space-y-2">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-[15px] leading-7 text-zinc-100">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-emerald-500/60 bg-zinc-950/40 px-4 py-3 rounded-xl my-4 text-zinc-200">
            {children}
          </blockquote>
        ),
code: ({ className, children, ...props }) => {
  const isBlock = typeof className === "string" && className.includes("language-");

  if (!isBlock) {
    // inline code
    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-zinc-900/70 border border-zinc-800 text-emerald-300 text-[13px]"
        {...props}
      >
        {children}
      </code>
    );
  }

  // code block (handled mostly by <pre>, but keep this safe)
  return (
    <code className="text-[13px] text-zinc-100" {...props}>
      {children}
    </code>
  );
},

        pre: ({ children }) => (
          <pre className="my-5 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 leading-6">
            {children}
          </pre>
        ),
        hr: () => <hr className="my-8 border-zinc-800" />,
        table: ({ children }) => (
          <div className="my-5 overflow-x-auto">
            <table className="w-full text-sm border border-zinc-800 rounded-xl overflow-hidden">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-zinc-900/60 text-zinc-100">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="text-left px-3 py-2 border-b border-zinc-800">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 border-b border-zinc-900 text-zinc-200">
            {children}
          </td>
        ),
      }}
    >
      {output}
    </ReactMarkdown>
  </div>
</div>


                ) : (
                  <div className="text-zinc-400">
                    <p className="font-semibold text-zinc-200">Nothing yet.</p>
                    <p className="text-sm mt-1">
                      Paste notes on the left, pick a mode, and click <span className="text-zinc-200">Run</span>.
                    </p>

                    <div className="mt-4 text-xs text-zinc-500">
                      Example notes to try:
                      <ul className="list-disc pl-5 mt-2 space-y-1">
                        <li>Derivative rules (power/product/chain)</li>
                        <li>Acid/base strength + pH calculations</li>
                        <li>Memory allocation in C (malloc/calloc/free)</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">History</h3>
            <button
            onClick={() => setHistory([])}
            disabled={history.length === 0}
            className="text-xs text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
            >
            Clear history
            </button>
        </div>

        <div className="mt-2 space-y-2 max-h-56 overflow-auto pr-1">
            {history.length === 0 ? (
            <p className="text-xs text-zinc-500">No history yet. Run something and it’ll appear here.</p>
            ) : (
history.map((h) => (
  <div
    key={h.id}
    className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 hover:bg-zinc-900/60 transition p-3"
  >
    <div className="flex items-start justify-between gap-3">
      <button
        onClick={() => {
          setMode(h.mode);
          setNotes(h.notes);
          setOutput(h.output);
          setError("");
        }}
        className="text-left flex-1"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-300 uppercase tracking-wide">
            {h.mode}
          </span>
          <span className="text-xs text-zinc-500">
            {new Date(h.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="text-sm text-zinc-100 mt-1">
          {h.notes.slice(0, 140) || "(empty notes)"}
        </div>
      </button>

      <button
        onClick={() => setHistory((prev) => prev.filter((x) => x.id !== h.id))}
        className="text-xs rounded-lg border border-zinc-800 px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-950/40"
        title="Delete this item"
      >
        Delete
      </button>
    </div>
  </div>
))

            )}
        </div>
        </div>


              <p className="text-xs text-zinc-500 mt-3">
                MVP note: add login + history later if you want it to feel like a real startup.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
