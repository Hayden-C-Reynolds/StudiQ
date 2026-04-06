// ── Supabase migrations (run manually in Supabase SQL editor) ─────────────────
//
// -- classes table
// create table classes (
//   id text,
//   user_id uuid references auth.users on delete cascade,
//   name text,
//   subject jsonb,
//   goal text,
//   created_at timestamp with time zone default timezone('utc', now()),
//   primary key (id, user_id)
// );
// alter table classes enable row level security;
// create policy "Users can manage own classes" on classes
//   for all using (auth.uid() = user_id);
//
// -- deadlines table
// create table deadlines (
//   id text,
//   user_id uuid references auth.users on delete cascade,
//   title text,
//   class_id text,
//   class_name text,
//   iso_date text,
//   display_date text,
//   date text,
//   days_until integer,
//   type text,
//   is_manual boolean default true,
//   primary key (id, user_id)
// );
// alter table deadlines enable row level security;
// create policy "Users can manage own deadlines" on deadlines
//   for all using (auth.uid() = user_id);
//
// -- todos table
// create table todos (
//   id text,
//   user_id uuid references auth.users on delete cascade,
//   text text,
//   done boolean default false,
//   class_id text,
//   created_at timestamp with time zone default timezone('utc', now()),
//   primary key (id, user_id)
// );
// alter table todos enable row level security;
// create policy "Users can manage own todos" on todos
//   for all using (auth.uid() = user_id);
//
// -- chat_history table
// create table chat_history (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid references auth.users on delete cascade,
//   class_id text,
//   class_name text,
//   feature text, -- 'tutor' or 'study-plan'
//   messages jsonb,
//   updated_at timestamp with time zone default timezone('utc', now())
// );
// alter table chat_history enable row level security;
// create policy "Users can manage own chat history" on chat_history
//   for all using (auth.uid() = user_id);
// -- Required for upsert conflict resolution:
// alter table chat_history
//   add constraint chat_history_user_class_feature_key
//   unique (user_id, class_id, feature);
//
// -- user_analytics table
// create table user_analytics (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid references auth.users on delete cascade,
//   event text not null,
//   metadata jsonb,
//   created_at timestamp with time zone default timezone('utc', now())
// );
// alter table user_analytics enable row level security;
// create policy "Users can insert own analytics" on user_analytics
//   for insert with check (auth.uid() = user_id);
// create policy "Users can read own analytics" on user_analytics
//   for select using (auth.uid() = user_id);
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import "./App.css";
import { InlineMath, BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import studiqLogo from "./assets/studiq-logo.png";
import { supabase } from './supabase';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

/* ═══════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════ */

const SUBJECTS = [
  { id: "math",    label: "Math",      icon: "📐", bg: "#EEF2FF", color: "#4338CA" },
  { id: "chem",    label: "Chemistry", icon: "⚗️",  bg: "#F5F3FF", color: "#7C3AED" },
  { id: "bio",     label: "Biology",   icon: "🧬", bg: "#ECFDF5", color: "#059669" },
  { id: "cs",      label: "Coding",    icon: "💻", bg: "#F0FDFA", color: "#0D9488" },
  { id: "history", label: "History",   icon: "📜", bg: "#FFFBEB", color: "#D97706" },
  { id: "english", label: "English",   icon: "✍️",  bg: "#FFF1F2", color: "#E11D48" },
  { id: "other",   label: "Other",     icon: "📚", bg: "#F3F4F6", color: "#6B7280" },
];

const FEATURES = [
  {
    id: "study-plan",
    icon: "📅",
    title: "Study Plan",
    desc: "Upload your syllabus and get a structured, day-by-day study schedule with every deadline clearly organized.",
    cta: "Generate Plan",
  },
  {
    id: "practice-test",
    icon: "📝",
    title: "Practice Test",
    desc: "Upload your study materials and get a custom quiz — multiple choice and short answer questions on key concepts.",
    cta: "Create Test",
  },
  {
    id: "tutor",
    icon: "💬",
    title: "AI Tutor",
    desc: "Ask questions and get guided through problems with a Socratic tutor that helps you think, not just memorize.",
    cta: "Start Chatting",
  },
];

let _nextId = 1;
const uid = () => String(_nextId++);

/* ═══════════════════════════════════════════════════════
   MARKDOWN RENDERER
   Converts Claude's markdown output to clean React elements.
   No raw ** ## or - symbols ever appear in the DOM.
═══════════════════════════════════════════════════════ */

/** Parse inline formatting: **bold**, *italic*, `code`, $math$, $$math$$ */
function renderInline(text) {
  // Order matters: $$ before $ to avoid partial matches; ** before * likewise
  const re = /(\$\$[^$]+?\$\$|\$[^$\n]+?\$|\*\*[^\n*]+\*\*|\*[^\n*]+\*|`[^\n`]+`)/g;
  const parts = [];
  let last = 0;
  let key = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith("$$")) {
      const math = tok.slice(2, -2).trim();
      parts.push(<InlineMath key={key++} math={math} renderError={() => <span>{tok}</span>} />);
    } else if (tok.startsWith("$")) {
      const math = tok.slice(1, -1).trim();
      parts.push(<InlineMath key={key++} math={math} renderError={() => <span>{tok}</span>} />);
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={key++}>{renderInlinePlain(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={key++} className="md-code">{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return parts.length ? parts : [<span key={0}>{text}</span>];
}

/** Renders inline math inside bold/em without recursing into bold again */
function renderInlinePlain(text) {
  const re = /(\$\$[^$]+?\$\$|\$[^$\n]+?\$)/g;
  const parts = [];
  let last = 0, key = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    const math = tok.startsWith("$$") ? tok.slice(2, -2).trim() : tok.slice(1, -1).trim();
    parts.push(<InlineMath key={key++} math={math} renderError={() => <span>{tok}</span>} />);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts.length ? parts : text;
}

/** Parse a markdown string into block tokens */
function parseBlocks(md) {
  const blocks = [];
  const lines = (md || "").split("\n");
  let listBuf = [];
  let listKind = null;
  let mathLines = [];
  let inMathBlock = false;

  const flush = () => {
    if (listBuf.length) {
      blocks.push({ t: listKind, items: [...listBuf] });
      listBuf = [];
      listKind = null;
    }
  };

  for (const line of lines) {
    const tr = line.trim();

    // Multi-line block math: standalone $$ on its own line
    if (tr === "$$") {
      if (inMathBlock) {
        blocks.push({ t: "math-block", math: mathLines.join("\n").trim() });
        mathLines = [];
        inMathBlock = false;
      } else {
        flush();
        inMathBlock = true;
      }
      continue;
    }
    if (inMathBlock) { mathLines.push(line); continue; }

    // Single-line block math: $$expr$$ on its own line
    if (tr.startsWith("$$") && tr.endsWith("$$") && tr.length > 4) {
      flush();
      blocks.push({ t: "math-block", math: tr.slice(2, -2).trim() });
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(tr)) {
      flush();
      blocks.push({ t: "hr" });
      continue;
    }

    // Headings — match leading # chars before a space
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      flush();
      blocks.push({ t: `h${hm[1].length}`, text: hm[2] });
      continue;
    }

    // Unordered list  (leading spaces allowed for indent, but we flatten)
    if (/^\s*[-*+] /.test(line)) {
      if (listKind === "ol") flush();
      listKind = "ul";
      listBuf.push(line.replace(/^\s*[-*+] /, ""));
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      if (listKind === "ul") flush();
      listKind = "ol";
      listBuf.push(line.replace(/^\s*\d+\.\s/, ""));
      continue;
    }

    // Blank line — ends any list
    if (tr === "") {
      flush();
      continue;
    }

    // Paragraph
    flush();
    blocks.push({ t: "p", text: line });
  }
  // Handle unclosed math block
  if (inMathBlock && mathLines.length > 0) {
    blocks.push({ t: "math-block", math: mathLines.join("\n").trim() });
  }
  flush();
  return blocks;
}

function MarkdownRenderer({ content, className = "" }) {
  const blocks = parseBlocks(content);

  return (
    <div className={`md-body ${className}`}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h1": return <h2 key={i} className="md-h1">{renderInline(b.text)}</h2>;
          case "h2": return <h2 key={i} className="md-h2">{renderInline(b.text)}</h2>;
          case "h3": return <h3 key={i} className="md-h3">{renderInline(b.text)}</h3>;
          case "h4": return <h4 key={i} className="md-h4">{renderInline(b.text)}</h4>;
          case "p":
            if (!b.text.trim()) return null;
            return <p key={i} className="md-p">{renderInline(b.text)}</p>;
          case "hr": return <hr key={i} className="md-hr" />;
          case "math-block":
            return (
              <div key={i} className="md-math-block">
                <BlockMath math={b.math} renderError={() => <pre className="math-raw">{b.math}</pre>} />
              </div>
            );
          case "ul":
            return (
              <ul key={i} className="md-ul">
                {b.items.map((it, j) => (
                  <li key={j} className="md-li">{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="md-ol">
                {b.items.map((it, j) => (
                  <li key={j} className="md-li">{renderInline(it)}</li>
                ))}
              </ol>
            );
          default: return null;
        }
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MATH TEXT — inline math rendering for plain strings
   Parses $...$ and $$...$$ in any text string and renders
   them with KaTeX. Everything else is plain text.
═══════════════════════════════════════════════════════ */

function MathText({ children }) {
  const text = String(children || "");
  const re = /(\$\$[^$]+?\$\$|\$[^$\n]+?\$)/g;
  const parts = [];
  let last = 0, key = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    const math = tok.startsWith("$$") ? tok.slice(2, -2).trim() : tok.slice(1, -1).trim();
    parts.push(<InlineMath key={key++} math={math} renderError={() => <span>{tok}</span>} />);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <>{parts.length ? parts : text}</>;
}

/* ═══════════════════════════════════════════════════════
   FILE UPLOAD ZONE
═══════════════════════════════════════════════════════ */

function FileUploadZone({ file, onFileChange, accept = ".pdf", label }) {
  const inputRef = useRef(null);
  const isImage = file && /\.(jpg|jpeg|png|heic|webp)$/i.test(file.name);
  const icon = file ? (isImage ? "🖼️" : "📄") : "📤";

  return (
    <div
      className={`upload-zone${file ? " upload-zone--filled" : ""}`}
      onClick={() => inputRef.current.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onFileChange(e.target.files[0]); }}
      />
      <div className="upload-zone-icon">{icon}</div>
      <div className="upload-zone-text">
        {file ? (
          <>
            <div className="upload-zone-filename">{file.name}</div>
            <div className="upload-zone-hint">Click to change file</div>
          </>
        ) : (
          <>
            <div className="upload-zone-label">{label}</div>
            <div className="upload-zone-hint">PDF, JPG, PNG, or HEIC · Click to browse</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   DEADLINES SIDEBAR
═══════════════════════════════════════════════════════ */

const DL_TYPE_ICON = { exam: "🧪", quiz: "📖", assignment: "📝", other: "📌" };

function deadlineBadgeClass(daysUntil) {
  if (daysUntil < 0)  return "dl-badge--gray";
  if (daysUntil <= 2) return "dl-badge--red";
  if (daysUntil <= 6) return "dl-badge--yellow";
  return "dl-badge--green";
}

function deadlineBadgeLabel(daysUntil) {
  if (daysUntil < 0)   return "Past due";
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `${daysUntil}d`;
}


/* ═══════════════════════════════════════════════════════
   STUDY PLAN SCREEN
═══════════════════════════════════════════════════════ */

function StudyPlanScreen({ cls, onBack, user, onSyncDeadlines, session }) {
  const [mode, setMode]         = useState("full");    // "full" | "test-prep"
  const [testDate, setTestDate] = useState("");
  const [file, setFile]         = useState(null);
  const [plan, setPlan]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  // Sync deadlines to global sidebar
  const [syncing, setSyncing]   = useState(false);
  const [syncMsg, setSyncMsg]   = useState("");

  // Follow-up chat
  const [chatMsgs, setChatMsgs]       = useState([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatLogRef = useRef(null);

  // Supabase persistence
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    const loadSaved = async () => {
      if (!session?.user?.id) {
        console.log('[StudyPlan] No session — skipping history load');
        setHistoryLoading(false);
        return;
      }
      console.log('[StudyPlan] Loading saved plan for user:', session.user.id, 'class:', cls.id);
      const { data, error } = await supabase
        .from('chat_history')
        .select('messages')
        .eq('user_id', session.user.id)
        .eq('class_id', String(cls.id))
        .eq('feature', 'study-plan')
        .maybeSingle();
      if (error) {
        console.error('[StudyPlan] Load error:', error);
      } else {
        console.log('[StudyPlan] Loaded:', data);
        if (data?.messages) {
          if (data.messages.plan) setPlan(data.messages.plan);
          if (data.messages.chatMsgs?.length > 0) setChatMsgs(data.messages.chatMsgs);
        }
      }
      setHistoryLoading(false);
    };
    loadSaved();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const savePlanToSupabase = async (currentPlan, currentChatMsgs) => {
    if (!session?.user?.id) return;
    console.log('[StudyPlan] Saving plan for user:', session.user.id, 'class:', cls.id);
    const { error } = await supabase.from('chat_history').upsert({
      user_id: session.user.id,
      class_id: String(cls.id),
      class_name: cls.name,
      feature: 'study-plan',
      messages: { plan: currentPlan, chatMsgs: currentChatMsgs },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,class_id,feature' });
    if (error) {
      console.error('[StudyPlan] Save error:', error);
    } else {
      console.log('[StudyPlan] Save successful');
    }
  };

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatMsgs, chatLoading]);

  const handleSyncDeadlines = async () => {
    if (!plan || syncing) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch(`${API_BASE}/extract-deadlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_plan: plan }),
      });
      const data = await res.json();
      const found = data.deadlines || [];
      onSyncDeadlines(found, cls);
      setSyncMsg(
        found.length > 0
          ? `${found.length} deadline${found.length === 1 ? "" : "s"} synced to your sidebar! ✅`
          : "No deadlines found in this plan."
      );
      setTimeout(() => setSyncMsg(""), 5000);
    } catch {
      setSyncMsg("Could not extract deadlines. Try again.");
      setTimeout(() => setSyncMsg(""), 4000);
    }
    setSyncing(false);
  };

  const handleModeChange = (m) => {
    setMode(m);
    setPlan("");
    setError("");
    setChatMsgs([]);
    setSyncMsg("");
  };

  const handleGenerate = async () => {
    if (!file) return;
    setLoading(true);
    setPlan("");
    setError("");
    setChatMsgs([]);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("class_name", cls.name);
    fd.append("subject", cls.subject.label);
    fd.append("mode", mode);
    fd.append("test_date", testDate.trim());
    fd.append("user_name", user?.name || "");
    fd.append("user_role", user?.role || "");
    fd.append("user_education", user?.role || "");

    try {
      const res = await fetch(`${API_BASE}/study-plan`, {
        method: "POST",
        headers: authHeaders(session),
        body: fd,
      });
      const data = await res.json();
      if (res.status === 429) {
        setError(data.detail || "You've reached your usage limit for today. Please try again tomorrow.");
      } else if (data.error) {
        setError(data.study_plan);
      } else {
        setPlan(data.study_plan);
        savePlanToSupabase(data.study_plan, []);
        trackEvent(session?.user?.id, "study_plan_generated", { class_name: cls.name, mode });
      }
    } catch {
      setError("Could not reach the backend. Make sure it's running on port 8000.");
    }
    setLoading(false);
  };

  const handleDownload = () => window.print();

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");

    const userMsg = { role: "user", content: text };
    const history = [...chatMsgs];
    const updated = [...history, userMsg];
    setChatMsgs(updated);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/study-plan-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_plan: plan, message: text, history, user_name: user?.name || "", user_role: user?.role || "" }),
      });
      const data = await res.json();
      const finalPlan = data.updated_plan || plan;
      const finalMsgs = [...updated, { role: "assistant", content: data.response }];
      setChatMsgs(finalMsgs);
      if (data.updated_plan) setPlan(finalPlan);
      savePlanToSupabase(finalPlan, finalMsgs);
    } catch {
      setChatMsgs([...updated, {
        role: "assistant",
        content: "Something went wrong connecting to the server. Please try again.",
      }]);
    }
    setChatLoading(false);
  };

  const isTestPrep    = mode === "test-prep";
  const planIcon      = isTestPrep ? "📚" : "📅";
  const planLabel     = isTestPrep ? "📚 Test Prep Plan" : "📅 Study Plan";
  const generateLabel = loading
    ? (isTestPrep ? "⏳  Building your test prep plan…" : "⏳  Building your study plan…")
    : (isTestPrep ? "🎯  Generate Test Prep Plan"       : "✨  Generate Study Plan");

  return (
    <div className="page">
      <div className="container sp-wrap">

        {/* ── Page header ── */}
        <div className="sp-page-header no-print">
          <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
          <div className="sp-class-row">
            <div className="sp-class-icon" style={{ background: cls.subject.bg }}>
              {cls.subject.icon}
            </div>
            <div>
              <h1 className="sp-class-name">{cls.name}</h1>
              <span className="subject-chip" style={{ background: cls.subject.bg, color: cls.subject.color }}>
                {cls.subject.icon} {cls.subject.label}
              </span>
            </div>
          </div>
        </div>

        {/* ── Upload card ── */}
        <section className="sp-card sp-upload-card no-print">
          <div className="sp-section-lead">
            <div className="sp-feature-icon">{planIcon}</div>
            <div>
              <h2 className="sp-card-title">Study Plan Generator</h2>
              <p className="sp-card-desc">
                {isTestPrep
                  ? "Upload a review sheet, notes, or any materials and get a focused study plan for your upcoming test."
                  : "Upload your syllabus as a PDF or photo and get a full semester study schedule."}
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="sp-mode-toggle">
            <button
              className={`sp-mode-btn${!isTestPrep ? " sp-mode-btn--active" : ""}`}
              onClick={() => handleModeChange("full")}
            >
              📅 Full Course Plan
            </button>
            <button
              className={`sp-mode-btn${isTestPrep ? " sp-mode-btn--active" : ""}`}
              onClick={() => handleModeChange("test-prep")}
            >
              🎯 Test Prep Plan
            </button>
          </div>

          {/* Test date — only visible in test-prep mode */}
          {isTestPrep && (
            <div className="sp-test-date-wrap">
              <label className="sp-test-date-label" htmlFor="sp-test-date">
                When is your test?
              </label>
              <input
                id="sp-test-date"
                className="sp-test-date-input"
                type="text"
                placeholder="e.g. this Friday, in 3 days, December 15th…"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
              />
            </div>
          )}

          <FileUploadZone
            file={file}
            onFileChange={setFile}
            accept=".pdf,.jpg,.jpeg,.png,.heic"
            label={isTestPrep ? "Upload review sheet or notes" : "Upload your syllabus"}
          />

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={loading || !file}
          >
            {generateLabel}
          </button>

          {error && <div className="sp-error">{error}</div>}
        </section>

        {/* ── History loading state ── */}
        {historyLoading && (
          <div className="sp-history-loading no-print">
            <div className="sp-spinner sp-spinner--sm" />
            <span>Loading saved plan…</span>
          </div>
        )}

        {/* ── Loading state ── */}
        {loading && (
          <div className="sp-loading-wrap no-print">
            <div className="sp-spinner" />
            <p className="sp-loading-text">
              {isTestPrep
                ? <>Building a focused test prep plan for <strong>{cls.name}</strong>{testDate ? ` — test ${testDate}` : ""}…</>
                : <>Analyzing your syllabus and building a personalized plan for <strong>{cls.name}</strong>…</>
              }
            </p>
          </div>
        )}

        {/* ── Results ── */}
        {plan && !loading && (
          <>
            {/* Action bar above plan */}
            <div className="sp-action-bar no-print">
              <div className="sp-action-bar-left">
                <button className="sp-download-btn-prominent" onClick={handleDownload}>
                  ⬇ Download PDF
                </button>
                <button
                  className="sp-sync-btn"
                  onClick={handleSyncDeadlines}
                  disabled={syncing}
                >
                  {syncing ? "⏳ Syncing…" : "📆 Save Plan & Sync Deadlines"}
                </button>
              </div>
              {syncMsg && <span className="sp-sync-msg">{syncMsg}</span>}
            </div>

            {/* Plan card — this IS printed */}
            <section className="sp-card sp-plan-card">

              {/* Print-only header — hidden on screen, shown when printing */}
              <div className="sp-print-header">
                <div className="sp-print-app">StudiQ</div>
                <h1 className="sp-print-title">
                  {cls.name} — {isTestPrep ? "Test Prep Plan" : "Study Plan"}
                </h1>
                <div className="sp-print-meta">
                  {cls.subject.label}
                  {testDate && isTestPrep ? ` · Test: ${testDate}` : ""}
                  {" · "}
                  {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              </div>

              {/* Screen topbar — hidden when printing */}
              <div className="sp-plan-topbar no-print">
                <span className="sp-plan-badge">{planLabel}</span>
                <span className="subject-chip" style={{ background: cls.subject.bg, color: cls.subject.color }}>
                  {cls.name}
                </span>
              </div>

              <MarkdownRenderer content={plan} className="sp-plan-md" />
            </section>

            {/* Follow-up chat — not printed */}
            <section className="sp-card sp-chat-card no-print">
              <div className="sp-section-lead">
                <div className="sp-feature-icon">💬</div>
                <div>
                  <h2 className="sp-card-title">Refine Your Plan</h2>
                  <p className="sp-card-desc">
                    Ask questions or request changes — "add more review time before the final" or
                    "I have Thursdays free, give me more work then."
                  </p>
                </div>
              </div>

              {chatMsgs.length > 0 && (
                <div className="sp-chat-log" ref={chatLogRef}>
                  {chatMsgs.map((msg, i) => (
                    <div key={i} className={`sp-msg sp-msg--${msg.role}`}>
                      <div className="sp-msg-avatar">
                        {msg.role === "assistant" ? "📅" : "👤"}
                      </div>
                      <div className="sp-msg-bubble">
                        {msg.role === "assistant"
                          ? <MarkdownRenderer content={msg.content} />
                          : <p className="sp-msg-text">{msg.content}</p>
                        }
                      </div>
                    </div>
                  ))}

                  {chatLoading && (
                    <div className="sp-msg sp-msg--assistant">
                      <div className="sp-msg-avatar">📅</div>
                      <div className="sp-msg-bubble sp-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="sp-input-row">
                <textarea
                  className="sp-textarea"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSend();
                    }
                  }}
                  placeholder="Ask about your plan or request changes…"
                  rows={2}
                />
                <button
                  className="sp-send-btn"
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  title="Send"
                >
                  ➤
                </button>
              </div>
              <p className="sp-input-hint">Enter to send · Shift+Enter for new line</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ONBOARDING SCREEN
═══════════════════════════════════════════════════════ */

const ROLES = ["High School Student", "College Student", "Graduate Student", "Self-Learner", "Teacher"];

/* ═══════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════ */

function AuthScreen() {
  const [mode, setMode]       = useState("login");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = mode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        if (err.message.includes("already registered") || err.message.includes("already exists")) {
          setError("An account with this email already exists. Try logging in.");
        } else if (err.message.includes("Invalid login credentials") || err.message.includes("invalid_credentials")) {
          setError("Incorrect email or password.");
        } else if (err.message.includes("Email not confirmed")) {
          setError("Please verify your email before logging in.");
        } else {
          setError(err.message);
        }
      } else if (data?.user?.id) {
        trackEvent(data.user.id, mode === "signup" ? "signup" : "login", { email: email.trim() });
      }
      // onAuthStateChange in App handles the session update
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError("");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (err) setError(err.message);
  };

  const handleGuest = async () => {
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInAnonymously();
    if (err) setError("Guest login unavailable, please sign up.");
    setLoading(false);
  };

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="onboard-brand">
          <img src={studiqLogo} alt="StudiQ" className="onboard-logo-img" />
          <p className="onboard-sub">AI-powered studying, personalized for you.</p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${mode === "login" ? " auth-tab--active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Log In
          </button>
          <button
            className={`auth-tab${mode === "signup" ? " auth-tab--active" : ""}`}
            onClick={() => { setMode("signup"); setError(""); }}
          >
            Sign Up
          </button>
        </div>

        <div className="onboard-fields">
          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="form-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="form-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button
          className="btn btn-primary onboard-cta"
          onClick={handleSubmit}
          disabled={loading || !email.trim() || !password.trim()}
        >
          {loading ? "…" : mode === "login" ? "Log In" : "Create Account"}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <button className="auth-google-btn" onClick={handleGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
            <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.32-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
            <path fill="#FBBC05" d="M11.68 28.18A13.77 13.77 0 0 1 10.8 24c0-1.45.25-2.85.68-4.18v-5.7H4.34A22.95 22.95 0 0 0 1 24c0 3.74.9 7.28 2.48 10.41l7.2-5.61-.48-1.18z" opacity=".3"/>
            <path fill="#FBBC05" d="M4.34 13.12l7.34 5.7A13.9 13.9 0 0 1 24 10.2c3.13 0 5.95 1.08 8.17 2.85l6.12-6.12C34.9 3.74 29.76 1 24 1c-8.6 0-16.04 4.93-19.66 12.12z"/>
            <path fill="#EA4335" d="M24 10.2c3.13 0 5.95 1.08 8.17 2.85l6.12-6.12C34.9 3.74 29.76 1 24 1c-8.6 0-16.04 4.93-19.66 12.12l7.34 5.7A13.9 13.9 0 0 1 24 10.2z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        <button className="auth-guest-btn" onClick={handleGuest} disabled={loading}>
          Try as Guest
        </button>
      </div>
    </div>
  );
}

function OnboardingScreen({ onComplete }) {
  const [name, setName]   = useState("");
  const [role, setRole]   = useState(null);
  const [hardest, setHardest] = useState("");

  const canSubmit = name.trim().length > 0 && role !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onComplete({ name: name.trim(), role, education: role, hardestSubject: hardest.trim() });
  };

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        <div className="onboard-brand">
          <img src={studiqLogo} alt="StudiQ" className="onboard-logo-img" />
          <p className="onboard-sub">AI-powered studying, personalized for you.</p>
        </div>

        <div className="onboard-fields">
          <div className="form-group">
            <label className="form-label" htmlFor="ob-name">What's your name?</label>
            <input
              id="ob-name"
              className="form-input"
              type="text"
              placeholder="e.g. Alex, Hayden…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Are you a…</label>
            <div className="onboard-pill-row">
              {ROLES.map((r) => (
                <button
                  key={r}
                  className={`onboard-pill${role === r ? " onboard-pill--active" : ""}`}
                  onClick={() => setRole(r)}
                  type="button"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ob-hard">
              What's your hardest subject? <span className="form-label-opt">(optional)</span>
            </label>
            <input
              id="ob-hard"
              className="form-input"
              type="text"
              placeholder="e.g. Calculus, Organic Chemistry…"
              value={hardest}
              onChange={(e) => setHardest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        </div>

        <button
          className="btn btn-primary onboard-cta"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          Let's get started →
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STUDY TIMER
═══════════════════════════════════════════════════════ */

const TIMER_PRESETS = [
  { label: "25 min", seconds: 25 * 60 },
  { label: "45 min", seconds: 45 * 60 },
  { label: "1 hr",   seconds: 60 * 60 },
  { label: "90 min", seconds: 90 * 60 },
];

function StudyTimer() {
  const [selected, setSelected]     = useState(0);
  const [customMin, setCustomMin]   = useState(30);
  const [total, setTotal]           = useState(TIMER_PRESETS[0].seconds);
  const [remaining, setRemaining]   = useState(TIMER_PRESETS[0].seconds);
  const [running, setRunning]       = useState(false);
  const [toast, setToast]           = useState(false);
  const [showPanel, setShowPanel]   = useState(false);
  const intervalRef = useRef(null);
  const wrapRef     = useRef(null);

  // Countdown tick
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            setToast(true);
            setTimeout(() => setToast(false), 4000);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPanel]);

  const applyPreset = (idx) => {
    setSelected(idx);
    const secs = TIMER_PRESETS[idx].seconds;
    setTotal(secs);
    setRemaining(secs);
    setRunning(false);
    setShowPanel(false);
  };

  const applyCustom = () => {
    const secs = Math.max(1, customMin) * 60;
    setSelected(-1);
    setTotal(secs);
    setRemaining(secs);
    setRunning(false);
    setShowPanel(false);
  };

  const handleReset = () => {
    setRunning(false);
    setRemaining(total);
    setShowPanel(false);
  };

  const pct = total > 0 ? remaining / total : 1;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const display = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  let displayClass = "timer-display";
  if (pct <= 0.1) displayClass += " timer-display--red";
  else if (pct <= 0.2) displayClass += " timer-display--orange";

  const activeLabel = selected >= 0 ? TIMER_PRESETS[selected].label : `${customMin}m`;

  return (
    <div className="timer-wrap no-print" ref={wrapRef}>
      {toast && <div className="timer-toast">Great study session!</div>}

      {/* Inline controls: display + play/pause + settings */}
      <div className="timer-inline">
        <span className={displayClass}>{display}</span>

        <button
          className="timer-btn"
          onClick={() => setRunning((r) => !r)}
          title={running ? "Pause" : "Start"}
          aria-label={running ? "Pause timer" : "Start timer"}
        >
          {running ? "⏸" : "▶"}
        </button>

        <button
          className={`timer-btn timer-btn--gear${showPanel ? " timer-btn--gear-active" : ""}`}
          onClick={() => setShowPanel((v) => !v)}
          title="Timer settings"
          aria-label="Timer settings"
        >
          ⚙
        </button>
      </div>

      {/* Settings dropdown */}
      {showPanel && (
        <div className="timer-panel">
          <div className="timer-panel-label">Duration</div>
          <div className="timer-panel-presets">
            {TIMER_PRESETS.map((p, i) => (
              <button
                key={i}
                className={`timer-preset${selected === i ? " timer-preset--active" : ""}`}
                onClick={() => applyPreset(i)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="timer-panel-custom">
            <input
              className="timer-custom-input"
              type="number"
              min={1}
              max={300}
              value={customMin}
              onChange={(e) => setCustomMin(Number(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()}
            />
            <span className="timer-custom-label">min</span>
            <button className="timer-custom-set" onClick={applyCustom}>Set</button>
          </div>

          <div className="timer-panel-divider" />

          <button className="timer-reset-btn" onClick={handleReset}>
            ↺ Reset to {activeLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   NAVBAR
═══════════════════════════════════════════════════════ */

function Navbar({ user, session, onToggleSidebar, onSignOut }) {
  const isGuest = session?.user?.is_anonymous === true;
  return (
    <nav className="nav">
      <button className="nav-sidebar-toggle no-print" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        ☰
      </button>
      <div className="nav-brand">
        <img src={studiqLogo} alt="StudiQ" className="nav-logo-img" />
      </div>
      <StudyTimer />
      {user && (
        <div className="nav-user">
          <div className="nav-user-avatar">{user.name.trim()[0].toUpperCase()}</div>
          <span className="nav-user-name">{user.name}</span>
          {isGuest ? (
            <button className="nav-create-account-btn no-print" onClick={onSignOut} title="Create an account">
              Create Account
            </button>
          ) : (
            <button className="nav-signout-btn no-print" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              ↩
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function FeedbackWidget() {
  return (
    <div className="feedback-widget no-print">
      <a
        className="feedback-btn"
        href="https://docs.google.com/forms/d/e/1FAIpQLSd7ckUeLYfarUQywXUgQw4BcTmEmnZBZP6Nh6dFfGr7hkEqlQ/viewform?usp=publish-editor"
        target="_blank"
        rel="noopener noreferrer"
      >
        Give Feedback
      </a>
      <a
        className="feedback-btn feedback-btn--survey"
        href="https://docs.google.com/forms/d/e/1FAIpQLScNLU0GFdiFKtKdUuKlypbos3xre_N2IXwgn2EKV5iRd5R_2w/viewform?usp=publish-editor"
        target="_blank"
        rel="noopener noreferrer"
      >
        Take Our Survey
      </a>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CREATE CLASS MODAL
═══════════════════════════════════════════════════════ */

function CreateClassModal({ onClose, onCreate }) {
  const [name, setName]       = useState("");
  const [subject, setSubject] = useState(null);
  const [goal, setGoal]       = useState("");

  const canCreate = name.trim().length > 0 && subject !== null;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({ id: uid(), name: name.trim(), subject, goal: goal.trim() });
    onClose();
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">Create a New Class</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="class-name">Class Name</label>
          <input
            id="class-name"
            className="form-input"
            type="text"
            placeholder="e.g. AP Chemistry, Calculus II, English Lit"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label">Subject</label>
          <div className="subject-grid">
            {SUBJECTS.map((s) => (
              <button
                key={s.id}
                className={`subj-btn${subject?.id === s.id ? " selected" : ""}`}
                onClick={() => setSubject(s)}
                type="button"
              >
                <span className="subj-btn-icon">{s.icon}</span>
                <span className="subj-btn-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="class-goal">
            Set a Goal <span className="form-label-opt">(optional)</span>
          </label>
          <input
            id="class-goal"
            className="form-input"
            type="text"
            placeholder="Get an A, Pass with 90%, Master integration techniques…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>

        <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate}>
          Create Class
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   HOME SCREEN
═══════════════════════════════════════════════════════ */

function HomeScreen({ classes, onAdd, onSelect, user }) {
  return (
    <div className="page">
      <div className="container">
        <div className="hero">
          <div className="hero-eyebrow">✦ AI-Powered Learning</div>
          <h1 className="hero-title">Welcome back, {user?.name || "there"} 👋</h1>
          <p className="hero-sub">
            {classes.length === 0
              ? "Create your first class to get started."
              : "Pick a class to dive in, or add a new one."}
          </p>
        </div>

        <div className="class-grid">
          {classes.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📚</div>
              <h3 className="empty-title">No classes yet</h3>
              <p className="empty-sub">
                Add your first class and unlock AI-powered study plans,
                practice tests, and a personal tutor.
              </p>
            </div>
          )}

          {classes.map((cls) => (
            <div key={cls.id} className="class-card" onClick={() => onSelect(cls)}>
              <div className="class-card-icon" style={{ background: cls.subject.bg }}>
                {cls.subject.icon}
              </div>
              <div>
                <p className="class-card-name">{cls.name}</p>
                <p className="class-card-subject">{cls.subject.label}</p>
              </div>
            </div>
          ))}

          <div
            className="add-card"
            onClick={onAdd}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
          >
            <div className="add-card-plus">+</div>
            <p className="add-card-label">Add New Class</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CLASS DETAIL SCREEN
═══════════════════════════════════════════════════════ */

function ClassDetailScreen({ cls, onBack, onFeature, onUpdateGoal }) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft]     = useState("");
  const inputRef = useRef(null);

  const startEdit = () => {
    setGoalDraft(cls.goal || "");
    setEditingGoal(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveGoal = () => {
    onUpdateGoal(cls.id, goalDraft.trim());
    setEditingGoal(false);
  };

  const cancelEdit = () => setEditingGoal(false);

  return (
    <div className="page">
      <div className="container">
        <div className="detail-header">
          <div className="detail-back">
            <button className="btn btn-ghost" onClick={onBack}>← All classes</button>
          </div>
          <div className="detail-meta">
            <div className="detail-class-icon" style={{ background: cls.subject.bg }}>
              {cls.subject.icon}
            </div>
            <div>
              <h1 className="detail-class-name">{cls.name}</h1>
              <span className="subject-chip" style={{ background: cls.subject.bg, color: cls.subject.color }}>
                {cls.subject.icon} {cls.subject.label}
              </span>
            </div>
          </div>
        </div>

        <div className="goal-banner">
          <div className="goal-banner-icon">🎯</div>
          <div className="goal-banner-body">
            <div className="goal-banner-label">Your Goal</div>

            {editingGoal ? (
              <div className="goal-edit-row">
                <input
                  ref={inputRef}
                  className="goal-edit-input"
                  value={goalDraft}
                  onChange={e => setGoalDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") saveGoal();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  placeholder="e.g. Get an A, Pass with 90%…"
                  maxLength={120}
                />
                <div className="goal-edit-actions">
                  <button className="goal-save-btn" onClick={saveGoal}>Save</button>
                  <button className="goal-cancel-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="goal-display-row" onClick={startEdit} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && startEdit()}>
                {cls.goal
                  ? <span className="goal-banner-text">{cls.goal}</span>
                  : <span className="goal-placeholder">Click to add a goal for this class…</span>
                }
                <span className="goal-edit-icon" aria-hidden="true">✎</span>
              </div>
            )}
          </div>
        </div>

        <p className="section-eyebrow">Study Tools</p>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.id} className="feature-card">
              <div className="feature-card-icon-wrap">{f.icon}</div>
              <h3 className="feature-card-title">{f.title}</h3>
              <p className="feature-card-desc">{f.desc}</p>
              <button className="btn-outline" onClick={() => onFeature(f)}>
                {f.cta} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   AI TUTOR SCREEN
═══════════════════════════════════════════════════════ */

const ACTION_META = {
  hint:          { label: "💡 Hint",        pill: "💡 Asked for a hint"         },
  explain:       { label: "📖 Explain",     pill: "📖 Asked for an explanation"  },
  "full-answer": { label: "✅ Full Answer", pill: "✅ Asked for the full answer" },
};

function TutorVideoCard({ video }) {
  return (
    <a
      className="tutor-yt-card"
      href={video.youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {/* Thumbnail row */}
      <div className="tutor-yt-thumb-wrap">
        {video.thumbnail ? (
          <img className="tutor-yt-thumb" src={video.thumbnail} alt={video.videoTitle} />
        ) : (
          <div className="tutor-yt-thumb tutor-yt-thumb--placeholder" />
        )}
        {/* Red play badge overlaid on thumbnail */}
        <div className="tutor-yt-play-badge">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      {/* Text row */}
      <div className="tutor-yt-body">
        <div className="tutor-yt-label">Suggested Video</div>
        <div className="tutor-yt-title">{video.videoTitle}</div>
        {video.channelName && (
          <div className="tutor-yt-channel">{video.channelName}</div>
        )}
      </div>
    </a>
  );
}

const CONCEPT_RE = /\b(what\s+is|what\s+are|what'?s\s+(a|an|the)|explain|how\s+does|how\s+do|how\s+to|why\s+does|why\s+do|help\s+me\s+understand|confused\s+about|what'?s\s+the\s+difference|difference\s+between|overview\s+of|introduction\s+to|define|definition\s+of|concept\s+of|walk\s+me\s+through)\b/i;

function isConceptQuestion(text) {
  if (!text || text.length < 5) return false;
  // Skip messages that look like raw equations or code
  if (/^[\d\s+\-*/^()=<>,.]+$/.test(text.trim())) return false;
  return CONCEPT_RE.test(text);
}

function TutorScreen({ cls, onBack, user, session }) {
  const welcomeId = useRef(uid()).current;
  const firstName = user?.name?.split(" ")[0] || "there";
  const welcomeMsg = {
    id: welcomeId,
    role: "assistant",
    isWelcome: true,
    content: `Hi ${firstName}! I'm your AI tutor for **${cls.name}**. I won't just hand you answers — I'll guide you through problems step by step so you build real understanding.\n\nAsk me anything, share a problem, or snap a photo of your homework. What would you like to work on?`,
  };
  const [messages, setMessages] = useState([welcomeMsg]);

  const [input, setInput]             = useState("");
  const [imageFile, setImageFile]     = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  const msgListRef    = useRef(null);
  const imageInputRef = useRef(null);
  const textareaRef   = useRef(null);

  // Load saved history on mount
  useEffect(() => {
    const loadHistory = async () => {
      if (!session?.user?.id) {
        console.log('[Tutor] No session — skipping history load');
        setHistoryLoading(false);
        return;
      }
      console.log('[Tutor] Loading history for user:', session.user.id, 'class:', cls.id);
      const { data, error } = await supabase
        .from('chat_history')
        .select('messages')
        .eq('user_id', session.user.id)
        .eq('class_id', String(cls.id))
        .eq('feature', 'tutor')
        .maybeSingle();
      if (error) {
        console.error('[Tutor] Load error:', error);
      } else {
        console.log('[Tutor] Loaded:', data);
        if (data?.messages?.length > 0) {
          setMessages(data.messages.map((m) => ({ ...m, id: m.id || uid() })));
        }
      }
      setHistoryLoading(false);
    };
    loadHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTutorHistory = async (msgs) => {
    if (!session?.user?.id) return;
    // Strip imagePreview (potentially large base64) before saving; cap at 20 messages
    const toSave = msgs.slice(-20).map(({ imagePreview: _ip, ...rest }) => rest);
    console.log('[Tutor] Saving', toSave.length, 'messages for user:', session.user.id, 'class:', cls.id);
    const { error } = await supabase.from('chat_history').upsert({
      user_id: session.user.id,
      class_id: String(cls.id),
      class_name: cls.name,
      feature: 'tutor',
      messages: toSave,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,class_id,feature' });
    if (error) {
      console.error('[Tutor] Save error:', error);
    } else {
      console.log('[Tutor] Save successful');
    }
  };

  // Scroll to bottom whenever messages or loading state changes
  useEffect(() => {
    if (msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Build text-only history for the API, starting from the first user message
  const buildApiHistory = (msgs = messages) => {
    const firstUser = msgs.findIndex((m) => m.role === "user");
    if (firstUser === -1) return [];
    return msgs.slice(firstUser).map((m) => ({
      role: m.role,
      content: m.textContent ?? m.content,
    }));
  };

  const sendToApi = async (formData, currentMsgs, userText) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tutor`, {
        method: "POST",
        headers: authHeaders(session),
        body: formData,
      });
      const data = await res.json();
      if (res.status === 429) {
        const final = [...currentMsgs, { id: uid(), role: "assistant", content: data.detail || "You've reached your usage limit for today. Please try again tomorrow." }];
        setMessages(final);
        saveTutorHistory(final);
        setLoading(false);
        return;
      }

      // Fire video suggestion in parallel if the message is a concept question
      let videoSuggestion = null;
      if (isConceptQuestion(userText)) {
        try {
          const vRes = await fetch(`${API_BASE}/get-video-suggestion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: userText, subject: cls.subject.label }),
          });
          const vData = await vRes.json();
          if (vData.youtubeUrl) videoSuggestion = vData;
        } catch {
          // video suggestion is best-effort, ignore failures
        }
      }

      const final = [...currentMsgs, { id: uid(), role: "assistant", content: data.response, videoSuggestion }];
      setMessages(final);
      saveTutorHistory(final);
    } catch {
      const final = [...currentMsgs, {
        id: uid(), role: "assistant",
        content: "Something went wrong connecting to the server. Make sure the backend is running on port 8000.",
      }];
      setMessages(final);
      saveTutorHistory(final);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !imageFile) return;

    trackEvent(session?.user?.id, "tutor_message_sent", { class_name: cls.name, subject: cls.subject.label });

    // Add user message to UI immediately
    const userMsg = {
      id: uid(),
      role: "user",
      content: text,
      textContent: text,
      imagePreview,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setImageFile(null);
    setImagePreview(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const fd = new FormData();
    fd.append("class_name", cls.name);
    fd.append("subject", cls.subject.label);
    fd.append("history", JSON.stringify(buildApiHistory(messages)));
    fd.append("user_message", text || "Please help me with this problem.");
    fd.append("user_name", user?.name || "");
    fd.append("user_role", user?.role || "");
    fd.append("user_education", user?.role || "");
    if (imageFile) fd.append("image", imageFile);

    await sendToApi(fd, next, text);
  };

  const handleAction = async (action) => {
    if (loading) return;

    const pill = ACTION_META[action].pill;
    const actionMsg = { id: uid(), role: "user", isAction: true, content: pill, textContent: pill };
    const next = [...messages, actionMsg];
    setMessages(next);
    setLoading(true);

    // History includes all real messages up to now
    const history = buildApiHistory(messages);

    try {
      const res = await fetch(`${API_BASE}/tutor-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: cls.name,
          subject: cls.subject.label,
          history,
          action,
          user_name: user?.name || "",
          user_role: user?.role || "",
          user_education: user?.role || "",
        }),
      });
      const data = await res.json();
      const final = [...next, { id: uid(), role: "assistant", content: data.response }];
      setMessages(final);
      saveTutorHistory(final);
    } catch {
      const final = [...next, {
        id: uid(), role: "assistant",
        content: "Something went wrong. Please try again.",
      }];
      setMessages(final);
      saveTutorHistory(final);
    }
    setLoading(false);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    if (file.name.toLowerCase().endsWith(".pdf")) {
      setImagePreview("__pdf__:" + file.name);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target.result);
      reader.readAsDataURL(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const handleTextareaChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const canSend = !loading && (input.trim().length > 0 || imageFile !== null);

  return (
    <div className="tutor-screen">

      {/* ── Header ── */}
      <div className="tutor-header">
        <button className="btn btn-ghost tutor-back-btn" onClick={onBack}>
          ← Back to {cls.name}
        </button>
        <div className="tutor-header-meta">
          <div className="tutor-header-icon" style={{ background: cls.subject.bg }}>
            {cls.subject.icon}
          </div>
          <div>
            <div className="tutor-header-name">{cls.name}</div>
            <span className="subject-chip" style={{ background: cls.subject.bg, color: cls.subject.color }}>
              {cls.subject.icon} {cls.subject.label}
            </span>
          </div>
          <div className="tutor-header-badge">AI Tutor</div>
        </div>
      </div>

      {/* ── Message list ── */}
      <div className="tutor-msg-list" ref={msgListRef}>
        {historyLoading && (
          <div className="tutor-history-loading">
            <div className="sp-spinner sp-spinner--sm" />
            <span>Loading saved conversation…</span>
          </div>
        )}
        {messages.map((msg) => {
          // Action pill — no avatar, centered-right
          if (msg.isAction) {
            return (
              <div key={msg.id} className="tutor-action-pill-row">
                <span className="tutor-action-pill">{msg.content}</span>
              </div>
            );
          }

          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className={`tutor-msg ${isUser ? "tutor-msg--user" : "tutor-msg--ai"}`}>
              {!isUser && (
                <div className="tutor-avatar tutor-avatar--ai">🎓</div>
              )}

              <div className="tutor-msg-col">
                <div className={`tutor-bubble ${isUser ? "tutor-bubble--user" : "tutor-bubble--ai"}`}>
                  {/* Image attachment */}
                  {msg.imagePreview && (
                    <img
                      src={msg.imagePreview}
                      alt="Attached problem"
                      className="tutor-attached-img"
                    />
                  )}
                  {isUser ? (
                    <p className="tutor-bubble-text">{msg.content}</p>
                  ) : (
                    <MarkdownRenderer content={msg.content} />
                  )}
                </div>
                {!isUser && msg.videoSuggestion && (
                  <TutorVideoCard video={msg.videoSuggestion} />
                )}
              </div>

              {isUser && (
                <div className="tutor-avatar tutor-avatar--user">👤</div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {loading && (
          <div className="tutor-msg tutor-msg--ai">
            <div className="tutor-avatar tutor-avatar--ai">🎓</div>
            <div className="tutor-bubble tutor-bubble--ai sp-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom input area ── */}
      <div className="tutor-footer">

        {/* Quick-action buttons */}
        <div className="tutor-actions">
          {Object.entries(ACTION_META).map(([key, meta]) => (
            <button
              key={key}
              className={`tutor-action-btn${key === "full-answer" ? " tutor-action-btn--answer" : ""}`}
              onClick={() => handleAction(key)}
              disabled={loading}
              title={meta.label}
            >
              {meta.label}
            </button>
          ))}
        </div>

        {/* Attachment preview */}
        {imagePreview && (
          <div className="tutor-attach-preview">
            {imagePreview.startsWith("__pdf__:") ? (
              <div className="tutor-attach-pdf">
                <span className="tutor-attach-pdf-icon">📄</span>
                <span className="tutor-attach-pdf-name">{imagePreview.slice("__pdf__:".length)}</span>
              </div>
            ) : (
              <img src={imagePreview} alt="Will be sent with your message" />
            )}
            <button
              className="tutor-attach-remove"
              onClick={() => { setImageFile(null); setImagePreview(null); }}
              title="Remove attachment"
            >
              ✕
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="tutor-input-row">
          <input
            ref={imageInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.heic"
            style={{ display: "none" }}
            onChange={handleImageSelect}
          />
          <button
            className="tutor-attach-btn"
            onClick={() => imageInputRef.current.click()}
            title="Attach a photo or PDF"
          >
            📎
          </button>

          <textarea
            ref={textareaRef}
            className="tutor-textarea"
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question or describe a problem…"
            rows={1}
          />

          <button
            className="tutor-send-btn"
            onClick={handleSend}
            disabled={!canSend}
            title="Send"
          >
            ➤
          </button>
        </div>

        <p className="tutor-footer-hint">
          Enter to send · Shift+Enter for newline · 📎 attach a photo of your problem
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PRACTICE TEST SCREEN
═══════════════════════════════════════════════════════ */

function PracticeTestScreen({ cls, onBack, user, session }) {
  const [screen, setScreen] = useState("config"); // "config" | "mock" | "quiz" | "results"
  const [questions, setQuestions] = useState([]);
  const [testMode, setTestMode] = useState("mock"); // "mock" | "quiz"

  // Config form state
  const [topics, setTopics] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState("Mixed");
  const [format, setFormat] = useState("Mixed");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [configFile, setConfigFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  // Mock test state
  const [mockAnswers, setMockAnswers] = useState({});
  const [mockImageFiles, setMockImageFiles] = useState({});
  const [grading, setGrading] = useState(false);
  const [gradeResults, setGradeResults] = useState(null);

  // Quiz mode state
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizImageFile, setQuizImageFile] = useState(null);
  const [quizFeedback, setQuizFeedback] = useState(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizHint, setQuizHint] = useState(null);
  const [quizExplain, setQuizExplain] = useState(null);
  const [quizHintLoading, setQuizHintLoading] = useState(false);
  const [quizExplainLoading, setQuizExplainLoading] = useState(false);
  const [quizHistory, setQuizHistory] = useState([]); // {questionId, correct, score}

  const mockImageInputRefs = useRef({});
  const quizImageInputRef = useRef(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError("");
    const fd = new FormData();
    fd.append("class_name", cls.name);
    fd.append("subject", cls.subject.label);
    fd.append("topics", topics);
    fd.append("question_count", questionCount);
    fd.append("difficulty", difficulty);
    fd.append("format", format);
    fd.append("additional_instructions", additionalInstructions);
    fd.append("user_name", user?.name || "");
    fd.append("user_role", user?.role || "");
    fd.append("user_education", user?.role || "");
    if (configFile) fd.append("file", configFile);

    try {
      const res = await fetch(`${API_BASE}/practice-test-generate`, { method: "POST", headers: authHeaders(session), body: fd });
      const data = await res.json();
      if (res.status === 429) {
        setGenError(data.detail || "You've reached your usage limit for today. Please try again tomorrow.");
        setGenerating(false);
        return;
      } else if (data.error) {
        setGenError(data.message || "Failed to generate questions.");
      } else {
        setQuestions(data.questions);
        trackEvent(session?.user?.id, "practice_test_generated", { class_name: cls.name, subject: cls.subject.label, question_count: questionCount, difficulty, format });
        if (testMode === "mock") setScreen("mock");
        else { setQuizIndex(0); setQuizHistory([]); setScreen("quiz"); }
      }
    } catch {
      setGenError("Could not reach the backend. Make sure it's running on port 8000.");
    }
    setGenerating(false);
  };

  const allMockAnswered = questions.length > 0 && questions.every((q) => {
    const ans = mockAnswers[q.id];
    return ans && (typeof ans === "string" ? ans.trim().length > 0 : true);
  });

  const handleMockSubmit = async () => {
    setGrading(true);
    const answers = questions.map((q) => ({ question_id: q.id, student_answer: mockAnswers[q.id] || "" }));
    try {
      const res = await fetch(`${API_BASE}/practice-test-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: cls.name, subject: cls.subject.label, questions, answers }),
      });
      const data = await res.json();
      if (data.error) { setGrading(false); return; }
      setGradeResults(data.results);
      setScreen("results");
    } catch { /* silent */ }
    setGrading(false);
  };

  const handleQuizSubmit = async () => {
    const q = questions[quizIndex];
    setQuizSubmitting(true);
    // If image answer
    if (quizImageFile && q.type === "short-answer") {
      const fd = new FormData();
      fd.append("question", q.question);
      fd.append("correct_answer", q.correctAnswer);
      fd.append("subject", cls.subject.label);
      fd.append("image", quizImageFile);
      try {
        const res = await fetch(`${API_BASE}/practice-test-grade-image`, { method: "POST", body: fd });
        const data = await res.json();
        setQuizFeedback({ correct: data.correct, explanation: data.explanation, correctAnswer: q.correctAnswer, studentAnswer: data.studentAnswer });
        setQuizHistory((prev) => [...prev, { questionId: q.id, correct: data.correct, score: data.score || 0 }]);
      } catch { setQuizFeedback({ correct: false, explanation: "Could not grade.", correctAnswer: q.correctAnswer, studentAnswer: "" }); }
    } else {
      try {
        const res = await fetch(`${API_BASE}/practice-test-grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class_name: cls.name, subject: cls.subject.label, questions: [q], answers: [{ question_id: q.id, student_answer: quizAnswer }] }),
        });
        const data = await res.json();
        if (data.results && data.results[0]) {
          const r = data.results[0];
          setQuizFeedback({ correct: r.correct, explanation: r.explanation, correctAnswer: r.correctAnswer, studentAnswer: r.studentAnswer });
          setQuizHistory((prev) => [...prev, { questionId: q.id, correct: r.correct, score: r.score || 0 }]);
        }
      } catch { setQuizFeedback({ correct: false, explanation: "Could not grade.", correctAnswer: q.correctAnswer, studentAnswer: quizAnswer }); }
    }
    setQuizSubmitting(false);
  };

  const handleQuizNext = () => {
    if (quizIndex + 1 >= questions.length) {
      setScreen("results");
    } else {
      setQuizIndex((i) => i + 1);
      setQuizAnswer("");
      setQuizImageFile(null);
      setQuizFeedback(null);
      setQuizHint(null);
      setQuizExplain(null);
    }
  };

  const handleQuizHint = async () => {
    setQuizHintLoading(true);
    const q = questions[quizIndex];
    try {
      const res = await fetch(`${API_BASE}/practice-test-hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: cls.name, subject: cls.subject.label, question: q.question, options: q.options }),
      });
      const data = await res.json();
      setQuizHint(data.hint);
    } catch { setQuizHint("Hint unavailable."); }
    setQuizHintLoading(false);
  };

  const handleQuizExplain = async () => {
    setQuizExplainLoading(true);
    const q = questions[quizIndex];
    try {
      const res = await fetch(`${API_BASE}/practice-test-explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_name: cls.name, subject: cls.subject.label, question: q.question, correct_answer: q.correctAnswer, options: q.options }),
      });
      const data = await res.json();
      setQuizExplain(data.explanation);
    } catch { setQuizExplain("Explanation unavailable."); }
    setQuizExplainLoading(false);
  };

  // ── Results screen (shared by both modes)
  if (screen === "results") {
    let results = gradeResults;
    // For quiz mode, build results from quizHistory
    if (testMode === "quiz") {
      results = quizHistory.map((h) => {
        const q = questions.find((qq) => qq.id === h.questionId);
        return { questionId: h.questionId, correct: h.correct, score: h.score, correctAnswer: q?.correctAnswer || "", explanation: q?.explanation || "" };
      });
    }
    const total = results ? results.length : 0;
    const correct = results ? results.filter((r) => r.correct).length : 0;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const grade = pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F";
    const gradeColor = pct >= 80 ? "#059669" : pct >= 60 ? "#D97706" : "#DC2626";

    return (
      <div className="page">
        <div className="container pt-wrap">
          <div className="pt-page-header">
            <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
          </div>

          <div className="pt-results-score-card">
            <div className="pt-results-badge" style={{ color: gradeColor, borderColor: gradeColor }}>
              {grade}
            </div>
            <div className="pt-results-pct" style={{ color: gradeColor }}>{pct}%</div>
            <div className="pt-results-fraction">{correct} / {total} correct</div>
            <p className="pt-results-sub">
              {pct >= 80 ? "Great work! Keep it up." : pct >= 60 ? "Good effort — review the questions you missed." : "Keep studying — you've got this!"}
            </p>
            <div className="pt-results-actions">
              <button className="btn btn-primary pt-results-btn" onClick={() => {
                setScreen("config"); setGradeResults(null); setMockAnswers({}); setMockImageFiles({});
                setQuizHistory([]); setQuizIndex(0); setQuizFeedback(null); setQuizHint(null); setQuizExplain(null);
              }}>
                Take Another Test
              </button>
            </div>
          </div>

          {results && results.map((r, i) => {
            const q = questions.find((qq) => qq.id === r.questionId) || questions[i];
            return (
              <div key={r.questionId} className={`pt-result-item ${r.correct ? "pt-result-item--correct" : "pt-result-item--wrong"}`}>
                <div className="pt-result-header">
                  <span className="pt-result-num">Q{r.questionId}</span>
                  <span className={`pt-result-badge ${r.correct ? "pt-result-badge--correct" : "pt-result-badge--wrong"}`}>
                    {r.correct ? "✓ Correct" : "✗ Incorrect"}
                  </span>
                </div>
                {q && <p className="pt-result-question"><MathText>{q.question}</MathText></p>}
                {!r.correct && (
                  <div className="pt-result-answers">
                    <div className="pt-result-answer pt-result-answer--wrong">
                      <span className="pt-result-answer-label">Your answer:</span> <MathText>{r.studentAnswer || "(no answer)"}</MathText>
                    </div>
                    <div className="pt-result-answer pt-result-answer--correct">
                      <span className="pt-result-answer-label">Correct answer:</span> <MathText>{r.correctAnswer}</MathText>
                    </div>
                  </div>
                )}
                {r.explanation && <p className="pt-result-explanation"><MathText>{r.explanation}</MathText></p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Quiz mode screen
  if (screen === "quiz") {
    const q = questions[quizIndex];
    const answered = quizFeedback !== null;
    const isLast = quizIndex + 1 >= questions.length;

    return (
      <div className="page">
        <div className="container pt-wrap">
          <div className="pt-page-header">
            <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
            <div className="pt-progress-bar-wrap">
              <div className="pt-progress-label">{quizIndex + 1} / {questions.length}</div>
              <div className="pt-progress-track">
                <div className="pt-progress-fill" style={{ width: `${((quizIndex + 1) / questions.length) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="pt-card pt-quiz-card">
            <div className="pt-question-type-chip">{q.type === "multiple-choice" ? "Multiple Choice" : "Short Answer"}</div>
            <p className="pt-question-text"><MathText>{q.question}</MathText></p>

            {q.type === "multiple-choice" && (
              <div className="pt-options">
                {q.options.map((opt, i) => {
                  let cls2 = "pt-option";
                  if (answered) {
                    if (opt === q.correctAnswer) cls2 += " pt-option--correct";
                    else if (opt === quizAnswer && !quizFeedback.correct) cls2 += " pt-option--wrong";
                  } else if (opt === quizAnswer) {
                    cls2 += " pt-option--selected";
                  }
                  return (
                    <button key={i} className={cls2} onClick={() => !answered && setQuizAnswer(opt)} disabled={answered}>
                      <span className="pt-option-letter">{String.fromCharCode(65 + i)}</span>
                      <MathText>{opt}</MathText>
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "short-answer" && !answered && (
              <div className="pt-sa-wrap">
                <textarea
                  className="pt-sa-textarea"
                  value={quizAnswer}
                  onChange={(e) => setQuizAnswer(e.target.value)}
                  placeholder="Type your answer here…"
                  rows={4}
                />
                <div className="pt-sa-or">— or attach a photo of your work —</div>
                <input ref={quizImageInputRef} type="file" accept=".jpg,.jpeg,.png,.heic" style={{ display: "none" }}
                  onChange={(e) => { if (e.target.files[0]) setQuizImageFile(e.target.files[0]); e.target.value = ""; }} />
                {quizImageFile ? (
                  <div className="pt-sa-img-row">
                    <span className="pt-sa-img-name">📎 {quizImageFile.name}</span>
                    <button className="pt-sa-img-remove" onClick={() => setQuizImageFile(null)}>✕</button>
                  </div>
                ) : (
                  <button className="pt-sa-attach-btn" onClick={() => quizImageInputRef.current.click()}>📎 Attach image</button>
                )}
              </div>
            )}

            {/* Hint / Explain buttons — only before answering */}
            {!answered && (
              <div className="pt-quiz-actions">
                <button className="pt-quiz-action-btn" onClick={handleQuizHint} disabled={quizHintLoading || quizSubmitting}>
                  {quizHintLoading ? "Loading…" : "💡 Hint"}
                </button>
                <button className="pt-quiz-action-btn" onClick={handleQuizExplain} disabled={quizExplainLoading || quizSubmitting}>
                  {quizExplainLoading ? "Loading…" : "📖 Explain"}
                </button>
              </div>
            )}

            {quizHint && !answered && (
              <div className="pt-hint-box"><strong>Hint:</strong> <MathText>{quizHint}</MathText></div>
            )}
            {quizExplain && !answered && (
              <div className="pt-explain-box"><MarkdownRenderer content={quizExplain} /></div>
            )}

            {/* Feedback after submit */}
            {answered && (
              <div className={`pt-feedback ${quizFeedback.correct ? "pt-feedback--correct" : "pt-feedback--wrong"}`}>
                <div className="pt-feedback-header">
                  {quizFeedback.correct ? "✓ Correct!" : "✗ Incorrect"}
                </div>
                {!quizFeedback.correct && (
                  <p className="pt-feedback-answer">Correct answer: <strong><MathText>{quizFeedback.correctAnswer}</MathText></strong></p>
                )}
                {quizFeedback.explanation && <p className="pt-feedback-explain"><MathText>{quizFeedback.explanation}</MathText></p>}
              </div>
            )}

            <div className="pt-quiz-footer">
              {!answered ? (
                <button
                  className="btn btn-primary"
                  onClick={handleQuizSubmit}
                  disabled={quizSubmitting || (!quizAnswer.trim() && !quizImageFile)}
                >
                  {quizSubmitting ? "Grading…" : "Submit Answer"}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleQuizNext}>
                  {isLast ? "See Results →" : "Next Question →"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mock test screen
  if (screen === "mock") {
    const answeredCount = questions.filter((q) => {
      const a = mockAnswers[q.id];
      return a && (typeof a === "string" ? a.trim().length > 0 : true);
    }).length;

    return (
      <div className="page">
        <div className="container pt-wrap">
          <div className="pt-page-header">
            <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
            <div className="pt-progress-bar-wrap">
              <div className="pt-progress-label">{answeredCount} / {questions.length} answered</div>
              <div className="pt-progress-track">
                <div className="pt-progress-fill" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
              </div>
            </div>
          </div>

          {questions.map((q, qi) => (
            <div key={q.id} className="pt-card pt-mock-question">
              <div className="pt-mock-question-header">
                <span className="pt-question-num">Question {qi + 1}</span>
                <span className="pt-question-type-chip">{q.type === "multiple-choice" ? "Multiple Choice" : "Short Answer"}</span>
              </div>
              <p className="pt-question-text"><MathText>{q.question}</MathText></p>

              {q.type === "multiple-choice" && (
                <div className="pt-options">
                  {q.options.map((opt, i) => (
                    <button
                      key={i}
                      className={`pt-option${mockAnswers[q.id] === opt ? " pt-option--selected" : ""}`}
                      onClick={() => setMockAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                    >
                      <span className="pt-option-letter">{String.fromCharCode(65 + i)}</span>
                      <MathText>{opt}</MathText>
                    </button>
                  ))}
                </div>
              )}

              {q.type === "short-answer" && (
                <div className="pt-sa-wrap">
                  <textarea
                    className="pt-sa-textarea"
                    value={mockAnswers[q.id] || ""}
                    onChange={(e) => setMockAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="Type your answer here…"
                    rows={3}
                  />
                  <div className="pt-sa-or">— or attach a photo of your work —</div>
                  <input
                    ref={(el) => { if (el) mockImageInputRefs.current[q.id] = el; }}
                    type="file"
                    accept=".jpg,.jpeg,.png,.heic"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        setMockImageFiles((prev) => ({ ...prev, [q.id]: e.target.files[0] }));
                        setMockAnswers((prev) => ({ ...prev, [q.id]: e.target.files[0].name }));
                      }
                      e.target.value = "";
                    }}
                  />
                  {mockImageFiles[q.id] ? (
                    <div className="pt-sa-img-row">
                      <span className="pt-sa-img-name">📎 {mockImageFiles[q.id].name}</span>
                      <button className="pt-sa-img-remove" onClick={() => {
                        setMockImageFiles((prev) => { const n = { ...prev }; delete n[q.id]; return n; });
                        setMockAnswers((prev) => { const n = { ...prev }; delete n[q.id]; return n; });
                      }}>✕</button>
                    </div>
                  ) : (
                    <button className="pt-sa-attach-btn" onClick={() => mockImageInputRefs.current[q.id]?.click()}>📎 Attach image</button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="pt-mock-submit-wrap">
            <button
              className="btn btn-primary pt-mock-submit-btn"
              onClick={handleMockSubmit}
              disabled={!allMockAnswered || grading}
            >
              {grading ? "Grading your test…" : `Submit Test (${answeredCount}/${questions.length} answered)`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Config screen (default)
  return (
    <div className="page">
      <div className="container pt-wrap">
        <div className="pt-page-header">
          <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
          <div className="pt-class-row">
            <div className="pt-class-icon" style={{ background: cls.subject.bg }}>{cls.subject.icon}</div>
            <div>
              <h1 className="pt-class-name">{cls.name}</h1>
              <span className="subject-chip" style={{ background: cls.subject.bg, color: cls.subject.color }}>
                {cls.subject.icon} {cls.subject.label}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-card pt-config-card">
          <div className="sp-section-lead">
            <div className="sp-feature-icon">📝</div>
            <div>
              <h2 className="sp-card-title">Practice Test Generator</h2>
              <p className="sp-card-desc">Configure your test and we'll generate custom questions tailored to {cls.name}.</p>
            </div>
          </div>

          {/* Test mode selector */}
          <div className="pt-field">
            <label className="pt-label">Test Mode</label>
            <div className="pt-mode-cards">
              <button
                className={`pt-mode-card${testMode === "mock" ? " pt-mode-card--active" : ""}`}
                onClick={() => setTestMode("mock")}
                type="button"
              >
                <div className="pt-mode-icon">📋</div>
                <div className="pt-mode-title">Mock Test</div>
                <div className="pt-mode-desc">All questions at once. Submit when done and see your score.</div>
              </button>
              <button
                className={`pt-mode-card${testMode === "quiz" ? " pt-mode-card--active" : ""}`}
                onClick={() => setTestMode("quiz")}
                type="button"
              >
                <div className="pt-mode-icon">🧩</div>
                <div className="pt-mode-title">Quiz Mode</div>
                <div className="pt-mode-desc">One question at a time with hints, explanations, and instant feedback.</div>
              </button>
            </div>
          </div>

          {/* Topics */}
          <div className="pt-field">
            <label className="pt-label" htmlFor="pt-topics">Topics to focus on <span className="pt-optional">(optional)</span></label>
            <input
              id="pt-topics"
              className="form-input"
              type="text"
              placeholder="e.g. Newton's laws, Chapter 4, photosynthesis…"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
            />
          </div>

          {/* Row: count + difficulty + format */}
          <div className="pt-field-row">
            <div className="pt-field">
              <label className="pt-label" htmlFor="pt-count">Number of Questions</label>
              <select id="pt-count" className="pt-select" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                {[5, 10, 15, 20, 30, 40, 50, 60, 80].map((n) => <option key={n} value={n}>{n} questions</option>)}
              </select>
            </div>
            <div className="pt-field">
              <label className="pt-label" htmlFor="pt-diff">Difficulty</label>
              <select id="pt-diff" className="pt-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {["Easy", "Medium", "Hard", "Mixed"].map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="pt-field">
              <label className="pt-label" htmlFor="pt-format">Question Format</label>
              <select id="pt-format" className="pt-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                {["Multiple Choice", "Short Answer", "Mixed"].map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>

          {/* Additional instructions */}
          <div className="pt-field">
            <label className="pt-label" htmlFor="pt-extra">Additional Instructions <span className="pt-optional">(optional)</span></label>
            <textarea
              id="pt-extra"
              className="pt-sa-textarea"
              rows={2}
              placeholder="e.g. include one tricky application question, focus on formulas…"
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
            />
          </div>

          {/* File upload */}
          <div className="pt-field">
            <label className="pt-label">Upload Study Materials <span className="pt-optional">(optional)</span></label>
            <p className="pt-upload-hint">Upload notes, slides, or a textbook excerpt — we'll use them to generate more accurate questions.</p>
            <FileUploadZone
              file={configFile}
              onFileChange={setConfigFile}
              accept=".pdf,.jpg,.jpeg,.png,.heic"
              label="Upload study materials"
            />
          </div>

          {genError && <div className="sp-error">{genError}</div>}

          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? "⏳ Generating questions…" : "✨ Generate Practice Test"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FEATURE PLACEHOLDER  (practice-test only now)
═══════════════════════════════════════════════════════ */

function FeaturePlaceholder({ cls, feature, onBack }) {
  return (
    <div className="page">
      <div className="container">
        <div style={{ paddingTop: "28px" }}>
          <button className="btn btn-ghost" onClick={onBack}>← Back to {cls.name}</button>
        </div>
        <div className="placeholder-wrap">
          <div className="placeholder-icon">{feature.icon}</div>
          <h2 className="placeholder-title">{feature.title}</h2>
          <p className="placeholder-class">for <strong>{cls.name}</strong></p>
          <p className="placeholder-note">This feature is on its way. Check back soon!</p>
          <span className="coming-soon-badge">🚧 Coming soon</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   APP SIDEBAR — Persistent left sidebar
   Sections: Deadlines & To-Do List
═══════════════════════════════════════════════════════ */

const DL_TYPES = ["exam", "quiz", "assignment", "other"];
const DL_TYPE_LABELS = { exam: "Exam", quiz: "Quiz", assignment: "Assignment", other: "Other" };

function getDaysUntil(isoStr) {
  if (!isoStr) return 999;
  // Expects YYYY-MM-DD; append T00:00:00 to force local midnight interpretation
  const d = new Date(isoStr.length === 10 ? isoStr + "T00:00:00" : isoStr);
  if (isNaN(d.getTime())) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function formatDisplayDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr + "T00:00:00");
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const DIVIDER_H  = 8;   // px height of the drag handle
const MIN_SECTION = 100; // px minimum height for either section

function AppSidebar({ isOpen, onClose, deadlines, todos, classes, onAddDeadline, onDeleteDeadline, onUpdateDeadline, onAddTodo, onToggleTodo, onDeleteTodo }) {
  const [dlFilter, setDlFilter]       = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId]           = useState(null);
  const emptyForm = { title: "", classId: "", date: "", type: "assignment" };
  const [form, setForm]               = useState(emptyForm);
  const [todoText, setTodoText]       = useState("");
  const [todoClassId, setTodoClassId] = useState("");
  const [splitPct, setSplitPct]       = useState(50);   // % of sidebar height for top section
  const sidebarRef                    = useRef(null);

  const handleDividerMouseDown = (e) => {
    e.preventDefault();
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    document.body.style.cursor    = "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (mv) => {
      const rect      = sidebar.getBoundingClientRect();
      const available = rect.height - DIVIDER_H;
      const offset    = mv.clientY - rect.top;
      const minPct    = (MIN_SECTION / available) * 100;
      const clamped   = Math.min(Math.max((offset / available) * 100, minPct), 100 - minPct);
      setSplitPct(clamped);
    };

    const onMouseUp = () => {
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
  };

  // Classes that have at least one deadline (for filter pills)
  const dlClassIds = [...new Set(deadlines.map(d => d.classId).filter(Boolean))];
  const dlClasses  = dlClassIds.map(cid => classes.find(c => c.id === cid)).filter(Boolean);

  // Filtered + sorted deadlines — sort by isoDate ascending (soonest first)
  const filteredDl = deadlines
    .filter(d => dlFilter === "all" || d.classId === dlFilter)
    .map(d => {
      const isoStr = d.isoDate || d.date || "";
      const computed = getDaysUntil(isoStr);
      return { ...d, displayDays: computed < 999 ? computed : (d.daysUntil ?? 999) };
    })
    .sort((a, b) => {
      const aIso = a.isoDate || a.date || "9999-99-99";
      const bIso = b.isoDate || b.date || "9999-99-99";
      return aIso.localeCompare(bIso);
    });

  // Todos: incomplete first, complete at bottom
  const sortedTodos = [
    ...todos.filter(t => !t.done),
    ...todos.filter(t => t.done),
  ];

  const handleAddDeadline = () => {
    if (!form.title.trim() || !form.date) return;
    const cls = classes.find(c => c.id === form.classId);
    onAddDeadline({
      id: uid(),
      title: form.title.trim(),
      classId: form.classId,
      className: cls?.name || "",
      isoDate: form.date,
      displayDate: formatDisplayDate(form.date),
      date: form.date,
      daysUntil: getDaysUntil(form.date),
      type: form.type,
      isManual: true,
    });
    setForm(emptyForm);
    setShowAddForm(false);
  };

  const handleStartEdit = (dl) => {
    setEditId(dl.id);
    setForm({ title: dl.title, classId: dl.classId || "", date: dl.isoDate || dl.date, type: dl.type });
    setShowAddForm(false);
  };

  const handleSaveEdit = () => {
    if (!form.title.trim()) return;
    const cls = classes.find(c => c.id === form.classId);
    onUpdateDeadline(editId, {
      title: form.title.trim(),
      classId: form.classId,
      className: cls?.name || "",
      isoDate: form.date,
      displayDate: formatDisplayDate(form.date),
      date: form.date,
      daysUntil: getDaysUntil(form.date),
      type: form.type,
    });
    setEditId(null);
    setForm(emptyForm);
  };

  const handleAddTodo = () => {
    if (!todoText.trim()) return;
    onAddTodo({ id: uid(), text: todoText.trim(), done: false, classId: todoClassId });
    setTodoText("");
    setTodoClassId("");
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}

      <aside className={`app-sidebar no-print${isOpen ? " app-sidebar--open" : ""}`} ref={sidebarRef}>
        <div className="sidebar-inner">

          {/* ═══ SECTION 1: DEADLINES ═══ */}
          <div className="sidebar-section" style={{ flex: splitPct }}>
            <div className="sidebar-section-hd">
              <span className="sidebar-section-title">📅 Deadlines</span>
              <button
                className="sidebar-add-btn"
                onClick={() => { setShowAddForm(v => !v); setEditId(null); setForm(emptyForm); }}
                title="Add deadline"
              >+</button>
            </div>

            {/* Class filter pills */}
            {dlClasses.length > 0 && (
              <div className="sidebar-filters">
                <button
                  className={`sidebar-filter${dlFilter === "all" ? " sidebar-filter--active" : ""}`}
                  onClick={() => setDlFilter("all")}
                >All</button>
                {dlClasses.map(c => (
                  <button
                    key={c.id}
                    className={`sidebar-filter${dlFilter === c.id ? " sidebar-filter--active" : ""}`}
                    onClick={() => setDlFilter(c.id)}
                  >{c.name}</button>
                ))}
              </div>
            )}

            {/* Add form — outside the scroll list so it doesn't scroll away */}
            {showAddForm && (
              <div className="sidebar-dl-form">
                <input
                  className="sidebar-input"
                  placeholder="e.g. Midterm Exam"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && handleAddDeadline()}
                />
                <select className="sidebar-select" value={form.classId} onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}>
                  <option value="">No class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input className="sidebar-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                <select className="sidebar-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {DL_TYPES.map(t => <option key={t} value={t}>{DL_TYPE_LABELS[t]}</option>)}
                </select>
                <div className="sidebar-form-actions">
                  <button className="sidebar-form-save" onClick={handleAddDeadline} disabled={!form.title.trim() || !form.date}>Add</button>
                  <button className="sidebar-form-cancel" onClick={() => { setShowAddForm(false); setForm(emptyForm); }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Scrollable deadline list */}
            <div className="sidebar-list">
              {filteredDl.length === 0 && !showAddForm && (
                <div className="sidebar-empty">No deadlines yet. Add one with + or sync from a study plan.</div>
              )}

              {filteredDl.map(dl => (
                editId === dl.id ? (
                  <div key={dl.id} className="sidebar-dl-form sidebar-dl-form--edit">
                    <input className="sidebar-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" />
                    <select className="sidebar-select" value={form.classId} onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}>
                      <option value="">No class</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input className="sidebar-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    <select className="sidebar-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                      {DL_TYPES.map(t => <option key={t} value={t}>{DL_TYPE_LABELS[t]}</option>)}
                    </select>
                    <div className="sidebar-form-actions">
                      <button className="sidebar-form-save" onClick={handleSaveEdit}>Save</button>
                      <button className="sidebar-form-cancel" onClick={() => { setEditId(null); setForm(emptyForm); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div key={dl.id} className="sidebar-dl-card">
                    <div className="sidebar-dl-left">
                      <div className="sidebar-dl-icon">{DL_TYPE_ICON[dl.type] || "📌"}</div>
                      <div className="sidebar-dl-body">
                        <div className="sidebar-dl-title">{dl.title}</div>
                        {dl.className && <div className="sidebar-dl-class">{dl.className}</div>}
                        <div className="sidebar-dl-date">{dl.displayDate || dl.date}</div>
                      </div>
                    </div>
                    <div className="sidebar-dl-right">
                      <div className={`dl-badge ${deadlineBadgeClass(dl.displayDays)}`}>
                        {deadlineBadgeLabel(dl.displayDays)}
                      </div>
                      <div className="sidebar-dl-actions">
                        {buildGCalUrl(dl) && (
                          <a
                            className="sidebar-icon-btn sidebar-icon-btn--cal"
                            href={buildGCalUrl(dl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Add to Google Calendar"
                          >📅</a>
                        )}
                        <button className="sidebar-icon-btn" onClick={() => handleStartEdit(dl)} title="Edit">✎</button>
                        <button className="sidebar-icon-btn sidebar-icon-btn--del" onClick={() => onDeleteDeadline(dl.id)} title="Delete">×</button>
                      </div>
                    </div>
                  </div>
                )
              ))}
            </div>
          </div>

          {/* ═══ DRAGGABLE DIVIDER ═══ */}
          <div className="sidebar-drag-handle" onMouseDown={handleDividerMouseDown}>
            <div className="sidebar-drag-grip"><span /><span /><span /></div>
          </div>

          {/* ═══ SECTION 2: TO-DO LIST ═══ */}
          <div className="sidebar-section" style={{ flex: 100 - splitPct, paddingTop: "12px" }}>
            <div className="sidebar-section-hd">
              <span className="sidebar-section-title">✅ To-Do</span>
            </div>

            {/* Add input — outside the scroll list */}
            <div className="sidebar-todo-input">
              <input
                className="sidebar-input"
                placeholder="Add a task…"
                value={todoText}
                onChange={e => setTodoText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddTodo()}
              />
              <div className="sidebar-todo-row">
                <select
                  className="sidebar-select sidebar-select--sm"
                  value={todoClassId}
                  onChange={e => setTodoClassId(e.target.value)}
                >
                  <option value="">No class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="sidebar-form-save" onClick={handleAddTodo} disabled={!todoText.trim()}>Add</button>
              </div>
            </div>

            {/* Scrollable todo list */}
            <div className="sidebar-list">
              {sortedTodos.length === 0 && (
                <div className="sidebar-empty">No tasks yet.</div>
              )}

              {sortedTodos.map(todo => {
                const todoCls = classes.find(c => c.id === todo.classId);
                return (
                  <div key={todo.id} className={`sidebar-todo${todo.done ? " sidebar-todo--done" : ""}`}>
                    <button
                      className={`sidebar-todo-check${todo.done ? " sidebar-todo-check--done" : ""}`}
                      onClick={() => onToggleTodo(todo.id)}
                      aria-label={todo.done ? "Mark incomplete" : "Mark complete"}
                    >{todo.done ? "✓" : ""}</button>
                    <div className="sidebar-todo-body">
                      <div className="sidebar-todo-text">{todo.text}</div>
                      {todoCls && <div className="sidebar-todo-class">{todoCls.name}</div>}
                    </div>
                    <button className="sidebar-icon-btn sidebar-icon-btn--del" onClick={() => onDeleteTodo(todo.id)} title="Delete">×</button>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </aside>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════ */

const API_BASE = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";

function authHeaders(session) {
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function trackEvent(userId, eventName, metadata = {}) {
  if (!userId) return;
  try {
    await supabase.from('user_analytics').insert({
      user_id: userId,
      event: eventName,
      metadata,
    });
  } catch {
    // fail silently
  }
}

function buildGCalUrl(dl) {
  const iso = dl.isoDate || dl.date || "";
  if (!iso) return null;
  const start = iso.replace(/-/g, "");
  // All-day events use YYYYMMDD; end is exclusive so add one day
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const end = d.toISOString().slice(0, 10).replace(/-/g, "");
  const details = [dl.className, DL_TYPE_LABELS[dl.type]].filter(Boolean).join(" · ");
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(dl.title)}` +
    `&dates=${start}/${end}` +
    `&details=${encodeURIComponent(details)}`
  );
}

export default function App() {
  const [session, setSession]             = useState(null);
  const [user, setUser]                   = useState(null);   // profile from DB
  const [authLoading, setAuthLoading]     = useState(true);
  const [view, setView]                   = useState("home");
  const [classes, setClasses]             = useState([]);
  const [activeClass, setActiveClass]     = useState(null);
  const [activeFeature, setActiveFeature] = useState(null);
  const [showModal, setShowModal]         = useState(false);
  const [sidebarOpen, setSidebarOpen]     = useState(false);

  const dataLoadedRef = useRef(false);

  // ── Auth: session + profile loading
  const loadProfile = async (s) => {
    const userId = s.user.id;

    // Anonymous (guest) users skip onboarding and get a default profile
    if (s.user.is_anonymous) {
      setUser({ name: "Guest", role: "College Student", education: "College Student", hardestSubject: "" });
      if (!dataLoadedRef.current) {
        await loadUserData(userId);
        dataLoadedRef.current = true;
      }
      setAuthLoading(false);
      return;
    }

    try {
      const { data } = await supabase
        .from("profiles")
        .select("name, role, education, hardest_subject")
        .eq("id", userId)
        .single();
      if (data) {
        setUser({ name: data.name, role: data.role, education: data.education || "", hardestSubject: data.hardest_subject || "" });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    // Load classes/deadlines/todos once per login
    if (!dataLoadedRef.current) {
      await loadUserData(userId);
      dataLoadedRef.current = true;
    }
    setAuthLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        loadProfile(s);
      } else {
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        loadProfile(s);
      } else {
        setUser(null);
        setAuthLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = async (profile) => {
    if (!session) return;
    await supabase.from("profiles").insert({
      id: session.user.id,
      name: profile.name,
      role: profile.role,
      education: profile.education,
      hardest_subject: profile.hardestSubject,
    });
    setUser(profile);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setClasses([]);
    setDeadlines([]);
    setTodos([]);
    dataLoadedRef.current = false;
  };

  // ── Global deadlines state
  const [deadlines, setDeadlines] = useState([]);

  const handleAddDeadline = async (dl) => {
    setDeadlines(prev => [...prev, dl]);
    if (session?.user?.id) {
      try {
        await supabase.from('deadlines').upsert({
          id: dl.id, user_id: session.user.id, title: dl.title,
          class_id: dl.classId || null, class_name: dl.className || null,
          iso_date: dl.isoDate || null, display_date: dl.displayDate || null,
          date: dl.date || null, days_until: dl.daysUntil ?? null,
          type: dl.type || 'other', is_manual: dl.isManual ?? true,
        });
      } catch { /* fail silently */ }
    }
  };

  const handleDeleteDeadline = async (id) => {
    setDeadlines(prev => prev.filter(d => d.id !== id));
    if (session?.user?.id) {
      try {
        await supabase.from('deadlines').delete().eq('id', id).eq('user_id', session.user.id);
      } catch { /* fail silently */ }
    }
  };

  const handleUpdateDeadline = async (id, changes) => {
    setDeadlines(prev => prev.map(d => d.id === id ? { ...d, ...changes } : d));
    if (session?.user?.id) {
      const db = {};
      if ('title'       in changes) db.title        = changes.title;
      if ('classId'     in changes) db.class_id     = changes.classId;
      if ('className'   in changes) db.class_name   = changes.className;
      if ('isoDate'     in changes) db.iso_date     = changes.isoDate;
      if ('displayDate' in changes) db.display_date = changes.displayDate;
      if ('date'        in changes) db.date         = changes.date;
      if ('daysUntil'   in changes) db.days_until   = changes.daysUntil;
      if ('type'        in changes) db.type         = changes.type;
      try {
        await supabase.from('deadlines').update(db).eq('id', id).eq('user_id', session.user.id);
      } catch { /* fail silently */ }
    }
  };

  const handleSyncDeadlines = (raw, cls) => {
    const userId = session?.user?.id;
    const mapped = raw.map(d => ({
      id: uid(),
      title: d.title,
      classId: cls.id,
      className: cls.name,
      isoDate: d.isoDate,
      displayDate: d.displayDate,
      date: d.isoDate || d.date,
      daysUntil: d.daysUntil,
      type: d.type || "other",
      isManual: false,
    }));
    setDeadlines(prev => [
      ...prev.filter(d => d.classId !== cls.id || d.isManual),
      ...mapped,
    ]);
    if (userId) {
      (async () => {
        try {
          await supabase.from('deadlines')
            .delete().eq('user_id', userId).eq('class_id', cls.id).eq('is_manual', false);
          if (mapped.length > 0) {
            await supabase.from('deadlines').upsert(mapped.map(dl => ({
              id: dl.id, user_id: userId, title: dl.title,
              class_id: dl.classId || null, class_name: dl.className || null,
              iso_date: dl.isoDate || null, display_date: dl.displayDate || null,
              date: dl.date || null, days_until: dl.daysUntil ?? null,
              type: dl.type || 'other', is_manual: false,
            })));
          }
        } catch { /* fail silently */ }
      })();
    }
  };

  // ── Global todos state
  const [todos, setTodos] = useState([]);

  const handleAddTodo = async (todo) => {
    setTodos(prev => [...prev, todo]);
    if (session?.user?.id) {
      try {
        await supabase.from('todos').upsert({
          id: todo.id, user_id: session.user.id, text: todo.text,
          done: todo.done, class_id: todo.classId || null,
        });
      } catch { /* fail silently */ }
    }
  };

  const handleToggleTodo = async (id) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newDone = !todo.done;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: newDone } : t));
    if (session?.user?.id) {
      try {
        await supabase.from('todos').update({ done: newDone }).eq('id', id).eq('user_id', session.user.id);
      } catch { /* fail silently */ }
    }
  };

  const handleDeleteTodo = async (id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
    if (session?.user?.id) {
      try {
        await supabase.from('todos').delete().eq('id', id).eq('user_id', session.user.id);
      } catch { /* fail silently */ }
    }
  };

  // ── Load all user data from Supabase on first login
  const loadUserData = async (userId) => {
    try {
      const [{ data: classRows }, { data: dlRows }, { data: todoRows }] = await Promise.all([
        supabase.from('classes').select('*').eq('user_id', userId),
        supabase.from('deadlines').select('*').eq('user_id', userId),
        supabase.from('todos').select('*').eq('user_id', userId),
      ]);
      if (classRows?.length > 0) {
        setClasses(classRows.map(r => ({
          id: r.id,
          name: r.name,
          subject: r.subject,
          goal: r.goal || "",
        })));
      }
      if (dlRows?.length > 0) {
        setDeadlines(dlRows.map(r => ({
          id: r.id,
          title: r.title,
          classId: r.class_id,
          className: r.class_name,
          isoDate: r.iso_date,
          displayDate: r.display_date,
          date: r.date,
          daysUntil: r.days_until,
          type: r.type,
          isManual: r.is_manual,
        })));
      }
      if (todoRows?.length > 0) {
        setTodos(todoRows.map(r => ({
          id: r.id,
          text: r.text,
          done: r.done,
          classId: r.class_id,
        })));
      }
    } catch {
      // fail silently — local state stays empty, app still works
    }
  };

  // ── Routing guards
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
      </div>
    );
  }
  if (!session) return <AuthScreen />;
  if (!user) return <OnboardingScreen onComplete={handleOnboardingComplete} />;

  const handleSelectClass = (cls) => {
    setActiveClass(cls);
    setView("class");
  };

  const handleUpdateGoal = async (classId, newGoal) => {
    const updated = (prev) => prev.map(c => c.id === classId ? { ...c, goal: newGoal } : c);
    setClasses(updated);
    setActiveClass(prev => prev?.id === classId ? { ...prev, goal: newGoal } : prev);
    if (session?.user?.id) {
      try {
        await supabase.from('classes').update({ goal: newGoal }).eq('id', classId).eq('user_id', session.user.id);
      } catch { /* fail silently */ }
    }
  };

  const handleSelectFeature = (feature) => {
    setActiveFeature(feature);
    setView("feature");
  };

  return (
    <>
      <Navbar user={user} session={session} onToggleSidebar={() => setSidebarOpen(v => !v)} onSignOut={handleSignOut} />

      <div className="app-body">
        <AppSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          deadlines={deadlines}
          todos={todos}
          classes={classes}
          onAddDeadline={handleAddDeadline}
          onDeleteDeadline={handleDeleteDeadline}
          onUpdateDeadline={handleUpdateDeadline}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onDeleteTodo={handleDeleteTodo}
        />

        <div className="app-content">
          {view === "home" && (
            <HomeScreen
              classes={classes}
              onAdd={() => setShowModal(true)}
              onSelect={handleSelectClass}
              user={user}
            />
          )}

          {view === "class" && activeClass && (
            <ClassDetailScreen
              cls={activeClass}
              onBack={() => setView("home")}
              onFeature={handleSelectFeature}
              onUpdateGoal={handleUpdateGoal}
            />
          )}

          {view === "feature" && activeClass && activeFeature && (
            activeFeature.id === "study-plan" ? (
              <StudyPlanScreen cls={activeClass} onBack={() => setView("class")} user={user} session={session} onSyncDeadlines={handleSyncDeadlines} />
            ) : activeFeature.id === "tutor" ? (
              <TutorScreen cls={activeClass} onBack={() => setView("class")} user={user} session={session} />
            ) : activeFeature.id === "practice-test" ? (
              <PracticeTestScreen cls={activeClass} onBack={() => setView("class")} user={user} session={session} />
            ) : (
              <FeaturePlaceholder cls={activeClass} feature={activeFeature} onBack={() => setView("class")} />
            )
          )}
        </div>
      </div>

      <FeedbackWidget />
      <Analytics />
      <SpeedInsights />

      {showModal && (
        <CreateClassModal
          onClose={() => setShowModal(false)}
          onCreate={async (newClass) => {
            setClasses((prev) => [...prev, newClass]);
            if (session?.user?.id) {
              try {
                await supabase.from('classes').upsert({
                  id: newClass.id,
                  user_id: session.user.id,
                  name: newClass.name,
                  subject: newClass.subject,
                  goal: newClass.goal || "",
                });
              } catch { /* fail silently */ }
            }
          }}
        />
      )}
    </>
  );
}
