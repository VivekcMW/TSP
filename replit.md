# TheSocialPundit

## Overview

TheSocialPundit is a B2B SaaS application that helps professionals build authority on LinkedIn and Twitter/X. The platform curates relevant industry content and uses AI to transform news articles into opinionated social media posts written in the user's unique voice. The core workflow enables users to go from login to published post in under 5 minutes.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens following a Linear/Notion-inspired aesthetic
- **Theme System**: Dark/light mode support with CSS custom properties

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Pattern**: RESTful endpoints under `/api/*` prefix
- **Build**: esbuild for server bundling, Vite for client bundling

### Database Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` for shared types between client and server
- **Migrations**: Drizzle Kit with migrations output to `/migrations`

### Authentication
- **Provider**: Replit Auth using OpenID Connect
- **Session Storage**: PostgreSQL-backed sessions via connect-pg-simple
- **Pattern**: Passport.js strategy with session-based authentication

### Key Data Models
- **Users**: Core user identity with profile information
- **UserProfiles**: Onboarding data including focus areas, publications, keywords, influencers, and companies
- **InboxItems**: Curated content matched to user interests
- **Drafts**: Generated social media posts pending publication

### Application Flow
1. Landing page with marketing content
2. Authentication via Replit Auth
3. Onboarding wizard to capture user preferences
4. Dashboard with curated inbox of relevant articles
5. Post generation modal for creating LinkedIn/Twitter content
6. **Instant Review** - Paste any article URL to generate 8 posts (4 tonalities × 2 platforms)
7. Drafts management and publishing workflow

### Key Features
- **Hot Trends**: Analyzes RSS feeds to show top 5 trending topics with article counts
- **Instant Review**: Generate posts from any URL with 4 tonalities (Thought Leader, Industry Insider, Provocateur, Data-Driven)
- **Tonality Mapping**: UI tonalities map to schema values (professional, authoritative, contrarian, ai-recommended)
- **Auto Publication Tracking**: When generating posts, the source publication is automatically added to user's preferences

### Modular Industry Engine System
The platform uses a modular engine architecture to deliver industry-specific content curation:

**Engine Architecture** (`server/services/engines/`)
- **BaseIndustryEngine**: Abstract base class with shared functionality (RSS fetching, keyword scoring, AI summarization, deduplication)
- **EngineRegistry**: Routes users to industry-specific engines based on their profile
- **Types**: `EngineConfig`, `EngineProcessResult`, `RSSFeedSource` interfaces

**Specialized Engines** (each with 10 RSS feeds and 20 trend keywords):
1. **Media & Advertising** - AdAge, Marketing Week, The Drum, Digiday
2. **Technology & SaaS** - TechCrunch, Ars Technica, Wired, The Verge
3. **Product Marketing** - Product-Led Growth, HubSpot, MarketingProfs
4. **Finance & Banking** - Financial Times, Bloomberg, WSJ, The Economist
5. **Healthcare & Pharma** - STAT News, Fierce Pharma, Healthcare Dive
6. **E-commerce & Retail** - Retail Dive, Modern Retail, eMarketer
7. **Default Engine** - General business news for other industries

**Engine API Endpoints:**
- `GET /api/engines` - Returns current engine and available specialized engines
- `GET /api/trends` - Hot trends using user's industry engine
- `POST /api/inbox/refresh` - Content refresh using industry-specific engine with fallback

**Database Tables:**
- `industry_sources` - Configurable RSS sources per industry
- `engine_run_logs` - Tracks engine execution for monitoring

## External Dependencies

### Database
- PostgreSQL database (connection via `DATABASE_URL` environment variable)

### Authentication
- Replit OpenID Connect provider (`ISSUER_URL` environment variable)
- Session secret (`SESSION_SECRET` environment variable)

### AI Services (Planned)
- Google Gemini API for content curation and post generation (referenced in design docs)

### Third-Party UI Libraries
- Radix UI for accessible component primitives
- Embla Carousel for carousel functionality
- React Day Picker for calendar components
- cmdk for command palette functionality
- Vaul for drawer components
- Recharts for analytics charts

### Development Tools
- Replit-specific Vite plugins for error overlay and development features

### Test Mode (Development Only)
Test mode provides quick development and debugging capabilities, only available when `NODE_ENV !== 'production'`:

**Test Endpoints:**
- `GET /api/test/status` - Check if test mode is available
- `POST /api/test/login` - Quick login with test user (test@thesocialpundit.com), bypasses auth
- `POST /api/test/reset` - Clear all inbox items, drafts, and reset profile to clean slate
- `POST /api/test/demo-data` - Populate sample articles and drafts for testing

**UI Controls:**
- Login page shows "Quick Test Login" button with amber styling
- Dashboard shows "Test Mode Active" banner with Reset Data and Load Demo Data buttons

### Industry Pre-Qualification
Users select their industry during registration to route to appropriate content curation engines:
- Media & Advertising, Product Marketing, Technology & SaaS, Finance & Banking
- Healthcare & Pharma, Consulting & Services, E-commerce & Retail, Real Estate
- Education & EdTech, Manufacturing, Energy & Sustainability, Legal Services
- Non-profit & NGO, Government & Public Sector, Hospitality & Travel
- Entertainment & Media, Telecommunications, Agriculture & Food, Other