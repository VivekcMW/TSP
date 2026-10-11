import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  Linkedin,
  MessageSquareText,
  Newspaper,
  Radar,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { EASE } from "@/lib/motion";

export type ProductIllustrationKey = "pundit" | "discover" | "create" | "content";

interface IllustrationProps {
  area: ProductIllustrationKey;
}

interface FrameProps {
  area: ProductIllustrationKey;
  label: string;
  children: React.ReactNode;
}

function IllustrationFrame({ area, label, children }: FrameProps) {
  return (
    <div
      className="relative overflow-hidden rounded-[1.5rem] border border-foreground/10 bg-foreground text-white shadow-2xl"
      role="img"
      aria-label={label}
      data-testid={`product-illustration-${area}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(hsl(var(--background)/0.12)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--background)/0.12)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
          Live workflow
        </span>
      </div>
      <div className="relative min-h-[27rem] p-4 sm:min-h-[31rem] sm:p-6">
        {children}
      </div>
    </div>
  );
}

function PunditIllustration() {
  const reduce = useReducedMotion();
  const enter = (delay: number) => reduce ? {} : {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay, ease: EASE },
  };
  const sources = [
    ["Campaign Asia", "Brand partnerships"],
    ["Exchange4Media", "Streaming and CTV"],
    ["Harvard Business Review", "Leadership"],
  ];

  return (
    <IllustrationFrame area="pundit" label="Illustration of Pundit building a personalised industry feed from a conversation">
      <div className="grid min-h-[25rem] gap-4 sm:grid-cols-[0.86fr_1.14fr]">
        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Pundit</p>
              <p className="text-[11px] text-white/45">Your setup agent</p>
            </div>
          </div>

          <motion.div {...enter(0.05)} className="ml-7 rounded-2xl rounded-tr-sm bg-white px-3.5 py-3 text-sm leading-relaxed text-foreground shadow-lg">
            I lead brand partnerships across media and streaming in Southeast Asia.
          </motion.div>
          <motion.div {...enter(0.18)} className="mt-3 mr-5 rounded-2xl rounded-tl-sm border border-white/10 bg-white/7 px-3.5 py-3 text-sm leading-relaxed text-white/80">
            Got it. I&apos;m mapping the publications, topics and people that shape that conversation.
          </motion.div>

          <div className="mt-auto pt-5">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-xs text-white/40">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />Tell Pundit what to refine…
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-white p-4 text-foreground sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">Building your brief</p>
              <p className="mt-1 font-heading text-lg font-semibold">Sources selected for you</p>
            </div>
            <motion.span
              animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
              transition={reduce ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-primary"
            >
              <Radar className="h-4 w-4" aria-hidden="true" />
            </motion.span>
          </div>

          <div className="mt-5 space-y-2.5">
            {sources.map(([source, topic], index) => (
              <motion.div
                key={source}
                {...enter(0.28 + index * 0.1)}
                className="flex items-center gap-3 rounded-xl border bg-background p-3 shadow-sm"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Newspaper className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{source}</p>
                  <p className="truncate text-xs text-muted-foreground">{topic}</p>
                </div>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-success-subtle text-success">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              </motion.div>
            ))}
          </div>

          <motion.div {...enter(0.62)} className="mt-4 rounded-xl border border-primary/20 bg-accent/60 p-3">
            <p className="text-xs font-semibold text-primary">Your feed is taking shape</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
              <motion.div
                initial={reduce ? false : { width: "18%" }}
                animate={{ width: "82%" }}
                transition={{ duration: reduce ? 0 : 1.1, delay: 0.35, ease: EASE }}
                className="h-full rounded-full bg-primary"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </IllustrationFrame>
  );
}

function DiscoverIllustration() {
  const reduce = useReducedMotion();
  const stories = [
    { source: "Reuters", time: "22m", title: "Global ad budgets move toward creator-led expertise", reason: "Matches your media strategy focus", active: true },
    { source: "Campaign Asia", time: "48m", title: "Streaming platforms rethink brand partnerships", reason: "Relevant to Southeast Asia", active: false },
    { source: "HBR", time: "1h", title: "The executive voice becomes a company asset", reason: "Matches a leader you follow", active: false },
  ];

  return (
    <IllustrationFrame area="discover" label="Illustration of Discover ranking timely industry stories and explaining their relevance">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-300">Your intelligence feed</p>
            <h4 className="mt-1 font-heading text-2xl font-semibold">Stories worth your opinion</h4>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Highly relevant
          </div>
        </div>

        <div className="relative mt-6 space-y-3">
          {stories.map((story, index) => (
            <motion.div
              key={story.title}
              initial={reduce ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.4, delay: index * 0.1, ease: EASE }}
              className={`group grid gap-4 rounded-2xl border p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                story.active ? "border-blue-400/50 bg-blue-400/10" : "border-white/10 bg-white/[0.045]"
              }`}
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${story.active ? "bg-blue-400 text-foreground" : "bg-white/10 text-white/60"}`}>
                {story.active ? <Radar className="h-5 w-5" aria-hidden="true" /> : <Newspaper className="h-5 w-5" aria-hidden="true" />}
              </span>
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-[11px] text-white/45">
                  <span>{story.source}</span><span>·</span><span>{story.time}</span>
                </div>
                <p className="font-medium leading-snug text-white/90">{story.title}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-200">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{story.reason}
                </p>
              </div>
              <ChevronRight className="hidden h-5 w-5 text-white/30 sm:block" aria-hidden="true" />
            </motion.div>
          ))}
        </div>

        <motion.div
          animate={reduce ? undefined : { opacity: [0.5, 1, 0.5] }}
          transition={reduce ? undefined : { duration: 2.2, repeat: Infinity }}
          className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/55"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />Watching 18 sources for new signals
        </motion.div>
      </div>
    </IllustrationFrame>
  );
}

function CreateIllustration() {
  const reduce = useReducedMotion();
  const line = "The strongest brands are no longer built only through campaigns. They are built through a credible point of view, expressed consistently.";

  return (
    <IllustrationFrame area="create" label="Illustration of Create turning a source into a social post in the user's voice">
      <div className="grid min-h-[25rem] gap-4 sm:grid-cols-[0.74fr_1.26fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">Source material</p>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3.5">
            <div className="flex items-center gap-2 text-xs text-white/45">
              <Newspaper className="h-4 w-4" aria-hidden="true" />Campaign Asia · 32m
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed text-white/85">
              Executive-led media is reshaping how brands earn trust in complex markets.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">Your direction</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {["Thought leader", "LinkedIn", "Concise"].map((chip, index) => (
                <span key={chip} className={`rounded-full border px-2.5 py-1.5 text-xs ${index === 0 ? "border-blue-300/40 bg-blue-300/10 text-blue-200" : "border-white/10 text-white/55"}`}>{chip}</span>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/10 p-3 text-xs text-white/50">
            <p className="flex items-center gap-2"><Globe2 className="h-4 w-4" aria-hidden="true" />Claims grounded in source</p>
          </div>
        </div>

        <div className="relative rounded-2xl bg-white p-4 text-foreground sm:p-5">
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-linkedin/10 text-brand-linkedin">
                <Linkedin className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold">LinkedIn draft</p>
                <p className="text-xs text-muted-foreground">In your voice</p>
              </div>
            </div>
            <span className="rounded-full bg-success-subtle px-2.5 py-1 text-[11px] font-semibold text-success">Source checked</span>
          </div>

          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.5, delay: 0.12 }}
            className="py-5"
          >
            <p className="font-heading text-xl font-semibold leading-snug">Expertise is becoming the most defensible media channel.</p>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{line}</p>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              The advantage is not volume. It is being useful at exactly the moment your industry is paying attention.
            </p>
          </motion.div>

          <div className="absolute inset-x-4 bottom-4 flex items-center justify-between border-t bg-white pt-4 sm:inset-x-5">
            <span className="text-xs text-muted-foreground">164 words · 42 sec read</span>
            <motion.span
              animate={reduce ? undefined : { y: [0, -2, 0] }}
              transition={reduce ? undefined : { duration: 1.8, repeat: Infinity }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Refine draft
            </motion.span>
          </div>
        </div>
      </div>
    </IllustrationFrame>
  );
}

function ContentIllustration() {
  const reduce = useReducedMotion();
  const days = ["MON", "TUE", "WED", "THU", "FRI"];
  const cards = [
    { day: 0, time: "9:00", title: "Why expertise is the new media channel", platform: "in", color: "bg-blue-100 text-blue-700" },
    { day: 2, time: "12:30", title: "The trust gap in B2B marketing", platform: "𝕏", color: "bg-slate-100 text-slate-700" },
    { day: 4, time: "8:45", title: "What leaders should say about AI adoption", platform: "in", color: "bg-blue-100 text-blue-700" },
  ];

  return (
    <IllustrationFrame area="content" label="Illustration of Content planning, approving and scheduling posts across a work week">
      <div className="rounded-2xl bg-white p-4 text-foreground sm:p-5">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">Content calendar</p>
            <h4 className="mt-1 font-heading text-xl font-semibold">Your week, ready for review</h4>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground">This week</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {days.map((day, index) => (
            <div key={day} className="min-w-0">
              <div className="mb-2 text-center">
                <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{day}</p>
                <p className={`mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${index === 0 ? "bg-primary text-primary-foreground" : ""}`}>{12 + index}</p>
              </div>
              <div className="min-h-60 rounded-xl border bg-background p-1.5 sm:p-2">
                {cards.filter(card => card.day === index).map((card, cardIndex) => (
                  <motion.div
                    key={card.title}
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.4, delay: 0.12 + cardIndex * 0.1, ease: EASE }}
                    className="rounded-lg border bg-white p-2 shadow-sm sm:p-3"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`grid h-6 w-6 place-items-center rounded-md text-[10px] font-bold ${card.color}`}>{card.platform}</span>
                      <span className="flex items-center gap-1 text-[9px] text-muted-foreground"><Clock3 className="h-3 w-3" aria-hidden="true" />{card.time}</span>
                    </div>
                    <p className="mt-3 hidden text-xs font-medium leading-snug sm:block">{card.title}</p>
                    <span className="mt-3 hidden items-center gap-1 text-[10px] font-semibold text-success sm:flex"><Check className="h-3 w-3" aria-hidden="true" />Approved</span>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.4, delay: 0.35, ease: EASE }}
          className="mt-4 ml-auto hidden w-fit items-center gap-3 rounded-xl bg-foreground px-4 py-3 shadow-xl sm:flex"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-success text-success-foreground"><Send className="h-4 w-4" aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-semibold text-white">3 posts scheduled</p>
            <p className="text-[11px] text-white/45">In your audience&apos;s time zone</p>
          </div>
        </motion.div>
      </div>
    </IllustrationFrame>
  );
}

export function ProductIllustration({ area }: IllustrationProps) {
  switch (area) {
    case "pundit":
      return <PunditIllustration />;
    case "discover":
      return <DiscoverIllustration />;
    case "create":
      return <CreateIllustration />;
    case "content":
      return <ContentIllustration />;
  }
}
