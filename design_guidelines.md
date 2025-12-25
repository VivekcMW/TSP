# TheSocialPundit Design Guidelines

## Design Approach

**Selected System**: Modern B2B SaaS pattern inspired by Linear and Notion
**Justification**: TheSocialPundit is a utility-focused productivity tool for professionals requiring clean workflows, information density, and daily usability. The Linear aesthetic provides the professional polish and efficiency needed for a B2B SaaS while maintaining visual appeal.

**Core Principles**:
- Clarity over decoration
- Information hierarchy through typography and spacing
- Purposeful white space for focus
- Professional, trustworthy aesthetic
- Speed and efficiency in every interaction

---

## Typography System

**Font Stack**: Inter (primary), JetBrains Mono (code/technical)

**Hierarchy**:
- Headlines (H1): text-4xl md:text-5xl, font-semibold, tracking-tight
- Section Headers (H2): text-3xl md:text-4xl, font-semibold
- Subsections (H3): text-xl md:text-2xl, font-medium
- Body Large: text-lg, font-normal, leading-relaxed
- Body Standard: text-base, leading-relaxed
- Body Small: text-sm
- Caption/Meta: text-xs, uppercase tracking-wide for labels

---

## Layout & Spacing System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16, 20
- Micro spacing: p-2, gap-2 (within components)
- Standard spacing: p-4, gap-4, m-6 (component padding)
- Section spacing: py-12 md:py-20, px-6 md:px-8
- Large breaks: py-16 md:py-32

**Container Strategy**:
- Marketing pages: max-w-7xl mx-auto
- App content: max-w-6xl mx-auto
- Reading content: max-w-3xl
- Sidebar layouts: 280px fixed sidebar + flex main content

---

## Component Library

### Landing Page Structure

**Hero Section** (80vh):
- Full-width container with centered content
- H1 headline + supporting subtext (max-w-3xl)
- Primary CTA + Secondary CTA (flex gap-4)
- Hero image: Dashboard mockup screenshot showing the inbox interface (positioned right side on desktop, full-width on mobile)
- Trust indicator bar below (logos/testimonial count)

**Social Proof Section**:
- 3-column grid (grid-cols-1 md:grid-cols-3)
- Large numbers + labels (stats on user growth, posts generated)

**Feature Showcase** (4-6 sections):
- Alternating 2-column layouts (text + screenshot)
- Each feature: icon, H3 title, description paragraph, screenshot/visual
- Features: LinkedIn onboarding, AI inbox curation, post generation, multi-platform support

**Pricing Section**:
- 3-column pricing cards (Free, Pro, Enterprise)
- Highlight recommended tier with subtle border treatment
- Feature comparison list for each tier

**CTA Section**:
- Full-width, centered, generous py-20
- Bold headline + primary action

**Footer**:
- 4-column grid: Product, Company, Resources, Legal
- Newsletter signup form
- Social links
- Trust badges (SOC2, GDPR compliant)

### Authentication Pages

**Layout**: Centered card (max-w-md), minimal, focused
- Logo + headline
- Social login buttons (Google, LinkedIn) with icons
- Divider with "or"
- Email/password form
- Link to alternate action (login ↔ signup)
- No distractions, clean background

### Onboarding Flow

**Progress Indicator**: Top of screen, 3 steps visualized
- Step 1: LinkedIn Connect
- Step 2: Define Focus
- Step 3: Review Profile

**LinkedIn Connect Screen**:
- Centered card explaining value proposition
- Bullet points on what data is accessed
- Large LinkedIn connect button
- Skip option (subtle, bottom)

**Single Input Screen**:
- Large textarea (h-32)
- Placeholder: "e.g., I'm a product manager in fintech who wants to share insights on AI and product strategy"
- Character count (150 max)
- Continue button

**AI Profile Review**:
- 4-tab interface: Publications, Keywords, Influencers, Companies
- Each tab shows grid of chips/cards (grid-cols-2 md:grid-cols-4)
- Each item: deletable (X icon), editable (click to edit)
- "Add custom" button in each section
- Confirm button (fixed bottom bar)

### Main Inbox Dashboard

**Layout**: Sidebar + Main Content
- Fixed sidebar (280px): Logo, navigation links, profile section
- Main area: Header + scrollable feed

**Inbox Header**:
- Page title + count badge
- Filter chips (All, Saved, Dismissed)
- Date selector (subtle)

**Inbox Cards** (grid-cols-1 gap-4):
- Card structure:
  - Source badge + timestamp (top-right)
  - Headline (text-lg font-semibold, 2 lines max)
  - Excerpt (text-sm, 3 lines max)
  - Matched keywords (chips, gap-2)
  - "Why this matters" insight (text-sm, italic)
  - Actions: Generate Post, Save, Dismiss (icon buttons)

**Empty State**: Centered illustration + helpful message

### Post Generation Modal

**Overlay**: Full-screen modal with backdrop blur
- Header: Article headline reference
- Platform selector: Large buttons (LinkedIn/Twitter)
- Tone selector: Button group (4 options)
- Generated draft: Large textarea (editable)
- Character count + platform limits
- Actions: Edit, Regenerate, Post Now, Save Draft

### Settings/Profile

**Tabs**: Profile, Preferences, Billing, Integrations
- Form layouts: 2-column on desktop (label left, input right)
- Section dividers with subtle borders
- Save changes button (sticky bottom bar)

---

## Navigation Patterns

**Marketing Nav**: Transparent → solid on scroll, max-w-7xl, flex justify-between
- Logo left
- Links center (hidden mobile, hamburger icon)
- CTA button right

**App Nav**: Fixed sidebar with:
- Logo (top)
- Main nav links (Inbox, Drafts, Published, Analytics)
- Bottom section: Settings, Logout

---

## Images

**Hero Image**: Dashboard screenshot showing the inbox interface with populated cards - professional, clean, aspirational. Position: Right 50% on desktop (lg:w-1/2), full-width on mobile. The screenshot should show 3-4 inbox cards with realistic content.

**Feature Screenshots**: 4 product interface screenshots showing:
1. LinkedIn onboarding confirmation screen
2. AI-generated profile review with chips
3. Inbox feed with multiple cards
4. Post generation modal with draft

**Team/Trust Section**: Founder photo or team photo (if applicable) - professional headshots with authentic feel.

---

## Mobile Considerations

- Hamburger menu for marketing nav
- Sidebar becomes bottom nav for app (4 icons max)
- Cards stack vertically (grid-cols-1)
- Modals become full-screen slides
- Touch targets minimum 44px
- Generous padding for thumbs (p-6 minimum)

---

## Performance & SEO

- Lazy load images below fold
- Critical CSS inline
- Preconnect to font CDNs
- Semantic HTML5 structure
- Meta descriptions per page
- OpenGraph tags for social sharing
- Schema.org markup for SaaS