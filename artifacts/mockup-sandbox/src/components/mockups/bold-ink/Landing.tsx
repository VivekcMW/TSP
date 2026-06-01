import React from "react";
import { 
  ArrowRight, 
  PlayCircle, 
  CheckCircle2, 
  Target, 
  BrainCircuit, 
  Zap,
  Building,
  Briefcase,
  LineChart,
  Stethoscope,
  Code
} from "lucide-react";

export function Landing() {
  return (
    <div className="min-h-screen bg-[#fafaf9] text-[#18181b] font-['Inter'] selection:bg-[#ede9fe] selection:text-[#7c3aed]">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-[#18181b] flex items-center justify-center">
            <span className="text-[#fafaf9] font-bold text-lg leading-none">P</span>
          </div>
          <span className="font-extrabold tracking-tight text-xl">TheSocialPundit</span>
        </div>
        <div className="flex items-center gap-4">
          <button className="hidden md:block px-4 py-2 font-medium text-gray-600 hover:text-[#18181b] transition-colors">
            Sign In
          </button>
          <button className="px-5 py-2.5 bg-[#7c3aed] text-white font-semibold rounded-lg hover:bg-opacity-90 transition-all shadow-sm">
            Start Free
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-16 md:pt-32 md:pb-24 px-6 md:px-12 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#ede9fe] text-[#7c3aed] text-sm font-semibold mb-8">
          <Zap size={16} className="fill-current" />
          <span>V2.0 Now Live — Smarter AI generation</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6 max-w-4xl mx-auto">
          Too busy to post on <span className="text-[#7c3aed] relative inline-block">
            LinkedIn?
            <svg className="absolute w-full h-3 -bottom-1 left-0 text-[#f59e0b]" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="4" fill="transparent" strokeLinecap="round" />
            </svg>
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
          Turn breaking industry news into viral thought-leadership posts in under 5 minutes. Build your personal brand on autopilot while you focus on actual work.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
          <button className="w-full sm:w-auto px-8 py-4 bg-[#f59e0b] text-[#18181b] font-bold rounded-xl text-lg hover:bg-opacity-90 hover:scale-105 transition-all shadow-lg flex items-center justify-center gap-2">
            Start Free Today
            <ArrowRight size={20} />
          </button>
          <button className="w-full sm:w-auto px-8 py-4 bg-transparent border-2 border-gray-200 text-[#18181b] font-bold rounded-xl text-lg hover:bg-gray-50 hover:border-gray-300 transition-all flex items-center justify-center gap-2">
            <PlayCircle size={20} className="text-gray-500" />
            See How It Works
          </button>
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-12 text-sm font-medium text-gray-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-[#7c3aed]" />
            <span>No Credit Card Required</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-[#7c3aed]" />
            <span>14-Day Free Trial</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-[#7c3aed]" />
            <span>Cancel Anytime</span>
          </div>
        </div>
      </section>

      {/* Feature Cards Row */}
      <section className="px-6 md:px-12 pb-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          
          <div className="bg-[#ede9fe] rounded-2xl p-8 transition-transform hover:-translate-y-1 group border border-transparent hover:border-[#7c3aed]/20">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-6 shadow-sm text-[#7c3aed] group-hover:scale-110 transition-transform">
              <Target size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#18181b] mb-3">Curated For Your Industry</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              We monitor 100+ niche RSS feeds. You get highly relevant news tailored precisely to your specific market segment every morning.
            </p>
          </div>

          <div className="bg-[#ede9fe] rounded-2xl p-8 transition-transform hover:-translate-y-1 group border border-transparent hover:border-[#7c3aed]/20">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-6 shadow-sm text-[#7c3aed] group-hover:scale-110 transition-transform">
              <BrainCircuit size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#18181b] mb-3">AI Writes Your POV</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Our models don't just summarize. They analyze your unique tone and extract hot-takes, contrarian views, and deep professional insights.
            </p>
          </div>

          <div className="bg-[#ede9fe] rounded-2xl p-8 transition-transform hover:-translate-y-1 group border border-transparent hover:border-[#7c3aed]/20">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-6 shadow-sm text-[#7c3aed] group-hover:scale-110 transition-transform">
              <Zap size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#18181b] mb-3">Post in 5 Min</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Approve, tweak, and publish. What used to take hours of brainstorming and drafting is now a quick daily 5-minute coffee routine.
            </p>
          </div>

        </div>
      </section>

      {/* Social Proof Strip */}
      <section className="bg-white border-y border-gray-100 py-16 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <p className="text-center font-bold text-gray-400 uppercase tracking-widest text-sm mb-8">
            Trusted by professionals in 11+ industries
          </p>
          
          <div className="flex flex-wrap justify-center gap-4 md:gap-6">
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600 font-semibold shadow-sm">
              <Briefcase size={16} className="text-[#f59e0b]" /> B2B SaaS
            </div>
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600 font-semibold shadow-sm">
              <LineChart size={16} className="text-[#f59e0b]" /> Fintech & Banking
            </div>
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600 font-semibold shadow-sm">
              <Stethoscope size={16} className="text-[#f59e0b]" /> Healthcare
            </div>
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600 font-semibold shadow-sm">
              <Code size={16} className="text-[#f59e0b]" /> Developer Tools
            </div>
            <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600 font-semibold shadow-sm">
              <Building size={16} className="text-[#f59e0b]" /> Commercial Real Estate
            </div>
          </div>
        </div>
      </section>
      
    </div>
  );
}
