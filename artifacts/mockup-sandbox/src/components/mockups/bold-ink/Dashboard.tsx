import React from "react";
import { 
  Inbox, 
  TrendingUp, 
  FileEdit, 
  CheckCircle, 
  BarChart3, 
  Settings, 
  Zap,
  Bookmark,
  X,
  Sparkles,
  ChevronRight,
  Hash
} from "lucide-react";

export function Dashboard() {
  return (
    <div className="flex h-screen w-full bg-[#fafaf9] text-[#18181b] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[240px] bg-[#18181b] text-white flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-[#7c3aed] flex items-center justify-center">
            <Zap size={20} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">TheSocialPundit</span>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-[#7c3aed] text-white font-medium transition-colors">
            <Inbox size={18} />
            <span>Inbox</span>
            <span className="ml-auto bg-white/20 text-xs py-0.5 px-2 rounded-full">12</span>
          </button>
          {[
            { icon: TrendingUp, label: "Hot Trends" },
            { icon: FileEdit, label: "Drafts" },
            { icon: CheckCircle, label: "Published" },
            { icon: BarChart3, label: "Analytics" },
            { icon: Settings, label: "Settings" },
          ].map((item, idx) => (
            <button key={idx} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors font-medium">
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-white/5 rounded-md transition-colors">
            <div className="w-9 h-9 rounded-full bg-[#f59e0b] flex items-center justify-center text-white font-bold">
              JS
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Jane Smith</p>
              <p className="text-xs text-gray-400 truncate">jane@example.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Header */}
        <header className="px-8 py-6 border-b border-[#ede9fe] bg-white sticky top-0 z-10 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#18181b]">Your Inbox for Technology & SaaS</h1>
            <p className="text-sm text-gray-500 mt-1">Curated insights ready for your next post.</p>
          </div>
          <button className="flex items-center gap-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm">
            <Sparkles size={18} />
            <span>Instant Review</span>
          </button>
        </header>

        <div className="p-8 max-w-4xl">
          {/* Tabs */}
          <div className="flex items-center gap-6 border-b border-[#ede9fe] mb-8">
            <button className="pb-3 border-b-2 border-[#7c3aed] text-[#18181b] font-medium px-1">
              All Items
            </button>
            <button className="pb-3 border-b-2 border-transparent text-gray-500 hover:text-[#18181b] font-medium px-1 transition-colors">
              Saved
            </button>
            <button className="pb-3 border-b-2 border-transparent text-gray-500 hover:text-[#18181b] font-medium px-1 transition-colors">
              Dismissed
            </button>
          </div>

          {/* Cards */}
          <div className="space-y-6">
            {[
              {
                source: "TechCrunch",
                date: "2 hours ago",
                title: "OpenAI announces new enterprise features for ChatGPT, targeting B2B SaaS integration",
                summary: "The new API capabilities allow deep integration into existing SaaS workflows, enabling seamless AI-driven data analysis without leaving the platform.",
                keywords: ["AI", "Enterprise", "API"],
              },
              {
                source: "SaaS Weekly",
                date: "5 hours ago",
                title: "Why usage-based pricing is replacing flat-rate subscriptions in 2024",
                summary: "As software tools become more infrastructure-like, companies are shifting away from per-seat models to value-aligned usage metrics to reduce churn.",
                keywords: ["Pricing", "Trends", "Growth"],
              },
              {
                source: "Marketing Dive",
                date: "Yesterday",
                title: "The rise of zero-click content: How B2B marketers are adapting to algorithm changes",
                summary: "With platforms favoring native content over external links, B2B brands are delivering full value directly in the feed to build trust and authority.",
                keywords: ["Marketing", "Social", "Algorithms"],
              }
            ].map((article, idx) => (
              <div key={idx} className="bg-white border border-[#ede9fe] rounded-xl p-6 hover:shadow-md hover:border-[#7c3aed]/30 transition-all group flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#7c3aed] bg-[#ede9fe] px-2.5 py-1 rounded-md">
                      {article.source}
                    </span>
                    <span className="text-sm text-gray-400 font-medium">{article.date}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-2 text-gray-400 hover:text-[#18181b] hover:bg-[#fafaf9] rounded-full transition-colors">
                      <Bookmark size={18} />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-[#18181b] leading-snug mb-2">
                    {article.title}
                  </h3>
                  <p className="text-[#18181b]/70 italic line-clamp-2 leading-relaxed">
                    "{article.summary}"
                  </p>
                </div>

                <div className="flex items-center justify-between mt-2 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    {article.keywords.map((kw, i) => (
                      <span key={i} className={`text-xs font-medium px-2.5 py-1 rounded-full ${i === 0 ? 'bg-[#f59e0b]/10 text-[#f59e0b]' : 'bg-[#ede9fe] text-[#7c3aed]'}`}>
                        <Hash size={12} className="inline mr-1" />
                        {kw}
                      </span>
                    ))}
                  </div>
                  <button className="bg-white border-2 border-[#ede9fe] text-[#7c3aed] font-medium px-4 py-2 rounded-lg hover:bg-[#ede9fe] hover:border-[#7c3aed] transition-all flex items-center gap-2">
                    <Sparkles size={16} />
                    Generate Post
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Right Panel */}
      <aside className="w-[280px] bg-white border-l border-[#ede9fe] shrink-0 overflow-y-auto hidden lg:block">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-6 text-[#18181b]">
            <TrendingUp size={20} className="text-[#f59e0b]" />
            <h2 className="font-bold text-lg tracking-tight">Hot Trends</h2>
          </div>

          <div className="space-y-5">
             {[
               { topic: "Generative AI Agents", count: 142, growing: true },
               { topic: "PLG Metrics", count: 89, growing: false },
               { topic: "B2B Influencer Marketing", count: 64, growing: true },
               { topic: "Vertical SaaS", count: 45, growing: false },
               { topic: "SOC2 Compliance", count: 28, growing: true },
             ].map((trend, idx) => (
               <div key={idx} className="group cursor-pointer">
                 <div className="flex items-center justify-between mb-1">
                   <span className="font-semibold text-sm text-[#18181b] group-hover:text-[#7c3aed] transition-colors">
                     #{trend.topic}
                   </span>
                   {trend.growing && (
                      <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                   )}
                 </div>
                 <div className="flex items-center justify-between text-xs text-gray-500">
                   <span>{trend.count} articles</span>
                   <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#7c3aed]" />
                 </div>
               </div>
             ))}
          </div>
          
          <div className="mt-8 p-4 rounded-xl bg-[#ede9fe] border border-[#7c3aed]/20">
             <h4 className="font-bold text-[#7c3aed] text-sm mb-2 flex items-center gap-2">
               <Zap size={16} /> Track New Topic
             </h4>
             <p className="text-xs text-[#18181b]/70 mb-3">
               Set up alerts for specific keywords or competitors.
             </p>
             <button className="w-full py-2 bg-white text-[#7c3aed] rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors">
               Add Tracker
             </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
