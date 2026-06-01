import React, { useState } from 'react';
import { X, Linkedin, Twitter, Sparkles, RefreshCw, Copy, ExternalLink, Hash } from 'lucide-react';

export function PostModal() {
  const [activePlatform, setActivePlatform] = useState('linkedin');
  const [activeTone, setActiveTone] = useState('thought-leader');
  const [hashtags, setHashtags] = useState(['AIMarketing', 'LinkedInGrowth', 'thesocialpundit']);

  const removeHashtag = (tagToRemove: string) => {
    setHashtags(hashtags.filter(tag => tag !== tagToRemove));
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8 relative" style={{ backgroundColor: '#18181b' }}>
      {/* Blurred background overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-0"></div>

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-5xl rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex overflow-hidden border border-[#27272a] animate-in fade-in zoom-in-95 duration-200" style={{ height: '80vh', maxHeight: '800px' }}>
        
        {/* Left Panel */}
        <div className="w-[280px] shrink-0 flex flex-col" style={{ backgroundColor: '#18181b' }}>
          <div className="p-6 border-b border-[#27272a]">
            <h2 className="text-lg font-semibold text-white">Post Options</h2>
            <p className="text-sm text-[#a1a1aa] mt-1">Configure your generated post</p>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            {/* Platform Selection */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">Platform</label>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setActivePlatform('linkedin')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-all ${activePlatform === 'linkedin' ? 'border-[#7c3aed] bg-[#7c3aed]/10 text-white shadow-[0_0_15px_-3px_rgba(124,58,237,0.3)]' : 'border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46] hover:text-white'}`}
                >
                  <Linkedin className="w-4 h-4" />
                  <span className="text-sm font-medium">LinkedIn</span>
                </button>
                <button 
                  onClick={() => setActivePlatform('twitter')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-all ${activePlatform === 'twitter' ? 'border-[#7c3aed] bg-[#7c3aed]/10 text-white shadow-[0_0_15px_-3px_rgba(124,58,237,0.3)]' : 'border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46] hover:text-white'}`}
                >
                  <Twitter className="w-4 h-4" />
                  <span className="text-sm font-medium">Twitter</span>
                </button>
              </div>
            </div>

            {/* Tone Selection */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">Voice & Tone</label>
              <div className="space-y-2">
                {[
                  { id: 'thought-leader', label: 'Thought Leader' },
                  { id: 'industry-insider', label: 'Industry Insider' },
                  { id: 'provocateur', label: 'Provocateur' },
                  { id: 'ai-picks', label: 'AI Picks' }
                ].map((tone) => (
                  <button
                    key={tone.id}
                    onClick={() => setActiveTone(tone.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left ${activeTone === tone.id ? 'border-[#7c3aed] bg-[#7c3aed] text-white shadow-[0_4px_14px_0_rgba(124,58,237,0.39)]' : 'border-[#27272a] text-[#a1a1aa] hover:bg-[#ede9fe]/5 hover:text-white'}`}
                  >
                    <span className="text-sm font-medium">{tone.label}</span>
                    {activeTone === tone.id && <Sparkles className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-[#27272a] space-y-3 shrink-0">
            <button className="w-full py-2.5 text-sm font-medium text-[#d4d4d8] rounded-lg border border-[#3f3f46] hover:bg-[#27272a] hover:text-white transition-colors">
              Save Draft
            </button>
            <button className="w-full py-3 text-sm font-bold text-[#18181b] rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_4px_14px_0_rgba(245,158,11,0.39)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.23)]" style={{ backgroundColor: '#f59e0b' }}>
              Post Now
            </button>
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col relative" style={{ backgroundColor: '#fafaf9' }}>
          {/* Close button */}
          <button className="absolute top-6 right-6 p-2 rounded-full text-[#71717a] hover:bg-[#e4e4e7] hover:text-[#18181b] transition-colors z-10">
            <X className="w-5 h-5" />
          </button>

          <div className="px-8 py-6 border-b border-[#e4e4e7] shrink-0">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#18181b' }}>Your Post</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 pr-12">
              <p className="text-sm font-medium text-[#71717a] line-clamp-1">
                The Future of AI is Not What You Think It Is
              </p>
              <a href="#" className="flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap" style={{ color: '#7c3aed' }}>
                View original article <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex-1 flex flex-col p-8 overflow-hidden">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md text-[#71717a] hover:bg-[#e4e4e7] hover:text-[#18181b] transition-colors">
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>
                <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md text-[#71717a] hover:bg-[#e4e4e7] hover:text-[#18181b] transition-colors">
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>
              <span className="text-xs font-semibold text-[#a1a1aa] tracking-wider">487 / 3000</span>
            </div>

            <textarea 
              className="flex-1 w-full bg-white border border-[#e4e4e7] rounded-xl p-6 text-[15px] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-[#7c3aed] focus:border-transparent transition-all shadow-sm"
              style={{ color: '#18181b' }}
              defaultValue={`Everyone is talking about AI replacing jobs, but we're missing the bigger picture.\n\nAfter reading today's breakdown on the latest LLM advancements, one thing is abundantly clear: the next decade belongs to the curators, not just the creators.\n\nAI isn't here to do your job. It's here to force you to level up your taste, your curation, and your strategy. If your job can be automated, your job was actually a task.\n\nWhat are you doing today to move from task-executor to strategist? 👇`}
            />

            <div className="mt-6 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {hashtags.map((tag) => (
                  <span 
                    key={tag} 
                    className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-sm font-medium transition-colors cursor-default group hover:bg-[#ddd6fe]"
                    style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}
                  >
                    #{tag}
                    <button 
                      onClick={() => removeHashtag(tag)}
                      className="p-0.5 rounded-full hover:bg-white/50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
                <div className="inline-flex items-center gap-1.5 pl-3 pr-4 py-1.5 rounded-full border border-dashed border-[#d4d4d8] text-sm text-[#71717a] hover:border-[#a1a1aa] hover:text-[#18181b] focus-within:border-[#7c3aed] focus-within:text-[#7c3aed] transition-colors cursor-text bg-white">
                  <Hash className="w-3.5 h-3.5" />
                  <input 
                    type="text" 
                    placeholder="Add hashtag" 
                    className="bg-transparent border-none outline-none text-sm placeholder-[#a1a1aa] w-24 focus:ring-0"
                    style={{ color: '#18181b' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
