# Profile Setup Page - Wireframe & Design Specs

## 📐 Layout Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Header / Navigation                      │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                            │
│   LEFT COLUMN        │         RIGHT COLUMN                      │
│   (25% - 30%)        │         (70% - 75%)                       │
│                      │                                            │
│  ┌────────────────┐  │  ┌──────────────────────────────────┐    │
│  │  STEPPER       │  │  │  FORM CONTENT                    │    │
│  │  PROGRESS      │  │  │  - Title                         │    │
│  │                │  │  │  - Description                   │    │
│  │  ✓ Step 1      │  │  │  - Input Fields                  │    │
│  │  → Step 2      │  │  │  - Validation Messages           │    │
│  │  ○ Step 3      │  │  │  - Action Buttons                │    │
│  │  ○ Step 4      │  │  │                                  │    │
│  │                │  │  │  [Next Button]                   │    │
│  └────────────────┘  │  └──────────────────────────────────┘    │
│                      │                                            │
└──────────────────────┴──────────────────────────────────────────┘
```

---

## 🎨 Detailed Component Layout

### LEFT SIDE - STEPPER COMPONENT

```
┌─────────────────────────┐
│   Profile Setup (4/4)   │
│   Progress Indicator    │
├─────────────────────────┤
│                         │
│  ┌─────────────────┐   │
│  │ ✓               │   │
│  │   Personal Info │   │
│  └────────┬────────┘   │
│           │            │
│           ◯ (line)     │
│           │            │
│  ┌─────────────────┐   │
│  │ ✓               │   │
│  │   Professional  │   │
│  └────────┬────────┘   │
│           │            │
│           ◯ (line)     │
│           │            │
│  ┌─────────────────┐   │
│  │ ✓               │   │
│  │   Interests     │   │
│  └────────┬────────┘   │
│           │            │
│           ◯ (line)     │
│           │            │
│  ┌─────────────────┐   │
│  │ → (active)      │   │
│  │   Preferences   │   │
│  └─────────────────┘   │
│                         │
│  Progress: ████░░░ 75%  │
│                         │
└─────────────────────────┘
```

### RIGHT SIDE - FORM CONTENT (Dynamic per Step)

```
┌──────────────────────────────────────────┐
│                                          │
│  Step 4 of 4: Profile Preferences       │
│                                          │
│  Customize how you want to use our      │
│  platform. These settings help us       │
│  personalize your experience.           │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  □ Enable Email Notifications           │
│                                          │
│  □ Show Public Profile                  │
│                                          │
│  □ Receive Weekly Digest                │
│                                          │
│  □ Allow Social Sharing                 │
│                                          │
│  Topic Preferences:                     │
│  ☑ Technology                           │
│  ☑ Business                             │
│  ☐ Entertainment                        │
│  ☐ Sports                               │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  [← Back]              [Finish Setup →]  │
│                                          │
└──────────────────────────────────────────┘
```

---

## 📋 The 4-Step Profile Setup Flow

### **Step 1: Personal Information**
```
┌────────────────────────────────────────────┐
│ Step 1 of 4: Personal Information          │
│                                            │
│ Tell us about yourself                     │
├────────────────────────────────────────────┤
│                                            │
│ Full Name *                                │
│ [________________________] ✓               │
│                                            │
│ Email *                                    │
│ [________________________] (read-only)     │
│                                            │
│ Bio                                        │
│ [________________________]                 │
│ [________________________]                 │
│                                            │
│ Profile Photo                              │
│ [Upload Photo] or [Use Avatar]             │
│ [  Avatar Preview  ]                       │
│                                            │
│ Location                                   │
│ [________] Country  [________] City        │
│                                            │
│               [Next →]                     │
└────────────────────────────────────────────┘
```

### **Step 2: Professional Information**
```
┌────────────────────────────────────────────┐
│ Step 2 of 4: Professional Details          │
│                                            │
│ Help us understand your background         │
├────────────────────────────────────────────┤
│                                            │
│ Headline (Job Title) *                     │
│ [________________________]                 │
│                                            │
│ Company                                    │
│ [________________________]                 │
│                                            │
│ Industry *                                 │
│ [Select Dropdown ▼]                        │
│  • Technology                              │
│  • Finance                                 │
│  • Healthcare                              │
│                                            │
│ Experience Level *                         │
│ ○ Student  ○ Beginner  ○ Intermediate     │
│ ○ Advanced  ○ Expert                       │
│                                            │
│ Website/Portfolio                          │
│ [________________________]                 │
│                                            │
│ [← Back]           [Next →]                │
└────────────────────────────────────────────┘
```

### **Step 3: Interests & Content Focus**
```
┌────────────────────────────────────────────┐
│ Step 3 of 4: Your Interests                │
│                                            │
│ Select topics you're interested in         │
├────────────────────────────────────────────┤
│                                            │
│ Primary Interest *                         │
│ [Select Dropdown ▼]                        │
│  • Artificial Intelligence                 │
│  • Cloud Computing                         │
│  • Web Development                         │
│  • Data Science                            │
│                                            │
│ Secondary Topics (Select multiple)        │
│ ☑ Machine Learning    ☑ DevOps             │
│ ☐ Blockchain         ☐ Cybersecurity      │
│ ☐ Mobile Dev         ☐ Product Design     │
│                                            │
│ Content Format Preference *                │
│ ○ Articles   ○ Video   ○ Podcasts  ○ All  │
│                                            │
│ Follow Experts/Influencers                │
│ [Add Tags: _____________] [+]              │
│ [Technology] [Business] [Leadership]      │
│                                            │
│ [← Back]           [Next →]                │
└────────────────────────────────────────────┘
```

### **Step 4: Preferences & Settings**
```
┌────────────────────────────────────────────┐
│ Step 4 of 4: Preferences                   │
│                                            │
│ Customize your experience                 │
├────────────────────────────────────────────┤
│                                            │
│ Notifications                              │
│ ☑ Email Notifications                     │
│   └─ Frequency: [Daily ▼]                 │
│ ☑ In-app Notifications                    │
│ ☐ SMS Alerts                              │
│                                            │
│ Privacy Settings                           │
│ ☑ Public Profile                          │
│ ☐ Show Email Address                      │
│ ☐ Allow Content Recommendations           │
│                                            │
│ Content Delivery                           │
│ ○ Immediate   ○ Daily   ○ Weekly          │
│                                            │
│ Theme Preference                           │
│ ○ Light   ○ Dark   ○ Auto                 │
│                                            │
│ [← Back]       [Complete Setup ✓]         │
└────────────────────────────────────────────┘
```

---

## 🎯 Key Design Features

### **Visual Hierarchy**
- ✅ Left stepper is compact & visual (icons, lines, status)
- ✅ Right form is spacious & readable (large input fields)
- ✅ Clear progress indication

### **User Engagement**
- ✅ Progress bar shows completion (75%, etc.)
- ✅ Checkmarks show completed steps (visual satisfaction)
- ✅ Active step highlighted with different styling
- ✅ Optional/Required field indicators

### **Mobile Responsive**
- 🔄 On mobile: Stack stepper above form or convert to horizontal tabs
- 🔄 Touch-friendly button sizes
- 🔄 Optimized spacing for smaller screens

### **Color Scheme**
- **Completed Steps**: Green checkmark + lighter background
- **Current Step**: Blue/Primary color + bold text
- **Upcoming Steps**: Gray + subtle styling
- **Input Focus**: Primary color border + shadow
- **Validation**: Red for errors, Green for success

### **Animations**
- ✨ Smooth fade-in when switching steps
- ✨ Checkmark animation on step completion
- ✨ Progress bar animation
- ✨ Button hover effects

---

## 💻 Component Structure

```typescript
// Main Component: ProfileSetup.tsx
├── LeftColumn
│   ├── StepperIndicator
│   │   ├── StepItem (completed)
│   │   ├── StepItem (active)
│   │   ├── StepItem (upcoming)
│   │   └── ProgressBar
│   └── SkipSetup Button
│
├── RightColumn
│   ├── StepHeader
│   │   ├── Title
│   │   └── Description
│   ├── FormContent (Dynamic per step)
│   │   ├── InputField(s)
│   │   ├── SelectField(s)
│   │   ├── CheckboxField(s)
│   │   └── RadioGroup(s)
│   └── FormActions
│       ├── BackButton
│       └── NextButton (or FinishButton)
│
└── Navigation & State Management
    ├── useStepper Hook
    ├── Form Validation
    └── Persisted Progress
```

---

## 🎬 Interaction Flow

1. **User lands on Step 1** → Stepper shows "Step 1 of 4", all fields empty
2. **User fills Personal Info** → "Next" button becomes enabled
3. **User clicks Next** → Fade animation, Step 1 marked complete ✓
4. **Step 2 loads** → Stepper updates, progress bar advances (25% → 50%)
5. **Repeat** until Step 4
6. **On Step 4 Complete** → "Finish Setup" button redirects to dashboard
7. **Skip Option**: User can skip any step, but Step 1 is mandatory

---

## 🎨 Color Tokens (Tailwind v4)

```css
--step-completed: var(--green-500);        /* ✓ Green */
--step-active: var(--blue-600);            /* → Blue */
--step-upcoming: var(--gray-400);          /* ○ Gray */
--input-focus: var(--blue-500);            /* Border on focus */
--input-error: var(--red-500);             /* Error messages */
--progress-bg: var(--gray-200);            /* Background */
--progress-fill: var(--blue-600);          /* Filled portion */
```

---

## ✨ Engagement Enhancements

1. **Micro-interactions**: 
   - Checkmark appears with animation on step completion
   - Input field glows on focus
   - Button scales on hover

2. **Progress Motivation**:
   - Show "75% Complete" to encourage finishing
   - Celebrate step completions with subtle animations

3. **Smart Defaults**:
   - Pre-fill email (read-only)
   - Remember selections if user goes back

4. **Mobile-First Animations**:
   - GPU-accelerated transitions
   - Reduced motion for accessibility

---

## 📱 Responsive Breakpoints

| Device | Layout | Stepper |
|--------|--------|---------|
| Mobile (< 768px) | Single Column | Horizontal Tabs |
| Tablet (768px - 1024px) | 2-Col (30/70) | Compact Left |
| Desktop (> 1024px) | 2-Col (25/75) | Full Left |

---

## 🚀 Ready for Implementation!

Would you like me to proceed with building this with:
- ✅ React components + TypeScript
- ✅ Tailwind CSS v4 styling
- ✅ React Hook Form for validation
- ✅ Zustand/TanStack Query for state management
- ✅ Smooth animations with Framer Motion
- ✅ Fully responsive design

