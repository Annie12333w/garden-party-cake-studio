import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { IdeaCard, Menu, OrderSpec, Quote } from "../types";
import type { ChatMessage } from "../pages/OrderPage";
import { errMsg, prettyDate, usd4 } from "../util";
import { Flags } from "./common";

const GREETING =
  "Hello and welcome to Garden Party Cake Studio! 🌿 I'm the Order Taker. What are we celebrating? Tell me about the occasion, how many guests, and any ideas you have. If you're not sure what you want yet, I'm happy to suggest a few seasonal designs.";

const STARTERS = [
  "It's my mom's 60th birthday, about 20 people",
  "I have no idea what I want, can you inspire me?",
  "Something with fresh berries for a bridal shower",
  "What's in season right now?",
];

export default function ConciergeChat({
  messages,
  setMessages,
  draft,
  onDraft,
  onQuote,
  onIdea,
  onPickDate,
  imageId,
  menu,
  loggedIn,
}: {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  draft: Partial<OrderSpec>;
  onDraft: (d: Partial<OrderSpec>, changed: string[]) => void;
  onQuote: (q: Quote | null) => void;
  onIdea: (i: IdeaCard) => void;
  onPickDate: (d: string) => void;
  imageId: number | null;
  menu: Menu | null;
  loggedIn: boolean;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await api.chat({ message, history, draft, inspiration_image_id: imageId });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: r.reply, ideas: r.ideas, suggested_dates: r.suggested_dates, flags: r.flags },
      ]);
      onDraft(r.draft ?? {}, r.changed_fields ?? []);
      onQuote(r.quote);
      setLastCost(r.usage?.cost_usd ?? null);
    } catch (e) {
      setError(errMsg(e));
      setMessages((m) => m.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const gallerySrc = (slug?: string | null) => (slug ? menu?.gallery.find((g) => g.slug === slug)?.image : undefined);

  return (
    <section className="chat-panel" aria-label="Order Taker chat">
      <div className="chat-head">
        <span className="avatar" aria-hidden="true">💌</span>
        <div>
          <strong>Order Taker</strong>
          <span className="tiny muted block">AI assistant · the studio reviews every order</span>
        </div>
      </div>
      <div className="chat-scroll" ref={scroller} aria-live="polite">
        <div className="msg assistant">
          <div className="bubble">{GREETING}</div>
        </div>
        {messages.length === 0 && (
          <div className="starters">
            {STARTERS.map((s) => (
              <button key={s} className="chip-btn" onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble prewrap">{m.content}</div>
            {m.flags && m.flags.length > 0 && <Flags flags={m.flags} />}
            {m.ideas && m.ideas.length > 0 && (
              <div className="idea-cards">
                {m.ideas.map((idea, j) => {
                  const src = gallerySrc(idea.gallery_slug);
                  return (
                    <div key={j} className="idea-card">
                      <div className="idea-thumb">{src ? <img src={src} alt="" /> : <span aria-hidden="true">✿</span>}</div>
                      <div>
                        <strong>{idea.title}</strong>
                        <p className="small">{idea.description}</p>
                        <button className="btn btn-sm btn-ghost" onClick={() => onIdea(idea)}>Use this idea</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {m.suggested_dates && m.suggested_dates.length > 0 && (
              <div className="date-chips" aria-label="Suggested pickup dates">
                {m.suggested_dates.map((d) => (
                  <button key={d} className={`chip-btn ${draft.pickup_date === d ? "on" : ""}`} onClick={() => onPickDate(d)}>
                    {prettyDate(d)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble thinking" aria-label="The Order Taker is thinking">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="tiny muted">thinking…</span>
            </div>
          </div>
        )}
      </div>
      {error && <div className="error-note small" role="alert">{error}</div>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Tell me about your celebration…"
          rows={2}
          aria-label="Message the Order Taker"
          maxLength={1500}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="tiny muted chat-foot">
        {loggedIn ? "Signed in: your past orders help with suggestions." : "Sign in to get suggestions based on your past orders."}
        {lastCost !== null && <> · last reply cost {usd4(lastCost)}</>}
      </p>
    </section>
  );
}
