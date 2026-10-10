import { COUNTRIES } from "@/lib/pricing-country";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, fieldTriggerClassName, type FieldControlProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Check, ChevronDown, Search, Sparkles, UserRound } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";


const industries = [
  { value: "media_advertising", label: "Media & Advertising" },
  { value: "product_marketing", label: "Product Marketing" },
  { value: "technology_saas", label: "Technology & SaaS" },
  { value: "finance_banking", label: "Finance & Banking" },
  { value: "healthcare_pharma", label: "Healthcare & Pharma" },
  { value: "consulting_services", label: "Consulting & Professional Services" },
  { value: "ecommerce_retail", label: "E-commerce & Retail" },
  { value: "real_estate", label: "Real Estate" },
  { value: "education_edtech", label: "Education & EdTech" },
  { value: "manufacturing", label: "Manufacturing & Industrial" },
  { value: "energy_sustainability", label: "Energy & Sustainability" },
  { value: "legal_services", label: "Legal Services" },
  { value: "nonprofit_ngo", label: "Non-profit & NGO" },
  { value: "government_public", label: "Government & Public Sector" },
  { value: "hospitality_travel", label: "Hospitality & Travel" },
  { value: "entertainment_media", label: "Entertainment & Media" },
  { value: "telecommunications", label: "Telecommunications" },
  { value: "agriculture", label: "Agriculture & Food" },
  { value: "other", label: "Other" },
];

/** The browser's time zone, so the first digest arrives at 9:00 local time. */
function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

interface CompleteRegistrationProps {
  existingFirstName?: string | null;
  existingLastName?: string | null;
  existingName?: string | null;
}

export default function CompleteRegistrationPage({ existingFirstName, existingLastName, existingName }: CompleteRegistrationProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const nameParts = (existingName || "").trim().split(/\s+/).filter(Boolean);
  const firstName = existingFirstName || nameParts[0] || "User";
  const lastName = existingLastName || nameParts.slice(1).join(" ") || "Member";
  const [industriesSelected, setIndustriesSelected] = useState<string[]>([]);
  const [countriesSelected, setCountriesSelected] = useState<string[]>([]);

  const completeRegistrationMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; industries: string[]; countries: string[]; timeZone?: string }) => {
      return await apiRequest("POST", "/api/complete-registration", data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      await queryClient.refetchQueries({ queryKey: ["/api/me"] });
      toast({
        title: "Welcome!",
        description: "Let's set up your profile.",
      });
      setLocation("/onboarding");
    },
    onError: (error: any) => {
      const message = error?.message || "Please try again.";
      const isUserNotFound = message.includes("not found");
      toast({
        title: isUserNotFound ? "Account Not Found" : "Something went wrong",
        description: isUserNotFound 
          ? "Your account was not found. Please sign up again." 
          : message,
        variant: "destructive",
      });
      if (isUserNotFound) {
        setTimeout(() => setLocation("/sign-up"), 2000);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (industriesSelected.length && countriesSelected.length) {
      completeRegistrationMutation.mutate({ firstName, lastName, industries: industriesSelected, countries: countriesSelected, timeZone: browserTimeZone() });
    }
  };

  const isValid = industriesSelected.length > 0 && countriesSelected.length > 0;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background px-4 py-6 sm:px-6 lg:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent" />
      <Reveal className="relative mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-5xl grid-cols-1 items-center gap-8 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1fr)] lg:gap-14">
        <section className="hidden space-y-6 lg:block" aria-labelledby="onboarding-welcome-title">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            About two minutes to a tailored workspace
          </div>
          <div className="space-y-3">
            <h1 id="onboarding-welcome-title" className="max-w-xl font-heading text-4xl font-semibold tracking-tight text-foreground xl:text-5xl">
              Your signal, without the noise.
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
              Tell us where you work, then Pundit will turn your focus into a live, editable intelligence feed.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {["Choose your market", "Describe what matters", "Review your curated feed"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border bg-card font-semibold text-primary shadow-sm">{index + 1}</span>
                <span className="font-medium">{item}</span>
              </div>
            ))}
          </div>
        </section>
        <Card className="w-full border-border/70 bg-card/95 shadow-xl shadow-primary/5 backdrop-blur">
          <CardHeader className="space-y-5 pb-4">
            <OnboardingProgress currentStep={1} />
            <div className="space-y-2 text-center sm:text-left">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-info-subtle sm:mx-0">
                <Sparkles className="h-6 w-6 text-info" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-info">Workspace basics</p>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Step 1 of 3</p>
                <CardTitle className="heading-dashboard text-2xl sm:text-3xl" data-testid="text-registration-title">Where should we focus?</CardTitle>
              </div>
              <CardDescription className="text-sm leading-relaxed">
                Choose your primary industry and market. You can add more now or update them later.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 rounded-[4px] border bg-muted/30 p-3" data-testid="text-saved-name">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10"><UserRound className="h-4 w-4 text-primary" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Your name</p><p className="truncate text-sm font-medium">{[firstName, lastName].filter(Boolean).join(" ")}</p></div>
              <Check className="h-4 w-4 text-success" aria-label="Name saved from signup" />
            </div>
            
            <Field id="registration-industries" label="Industry"
              help="Choose the field closest to your work."
              controlProps={{ "aria-describedby": "registration-industries-limit" }} render={(controlProps) => <>
                <MultiSelect controlProps={controlProps} label="Select industries" options={industries} selected={industriesSelected} onChange={setIndustriesSelected} testId="industries" />
                <p id="registration-industries-limit" className="text-xs text-muted-foreground">Select up to 10 industries.</p>
              </>} />
            
            <Field id="registration-countries" label="Market"
              help="Choose the region you want recommendations from."
              controlProps={{ "aria-describedby": "registration-countries-limit" }} render={(controlProps) => <>
                <MultiSelect controlProps={controlProps} label="Select countries" options={COUNTRIES.map((country) => ({ value: country, label: country }))} selected={countriesSelected} onChange={setCountriesSelected} testId="countries" />
                <p id="registration-countries-limit" className="text-xs text-muted-foreground">Select up to 10 countries.</p>
              </>} />
            
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!isValid || completeRegistrationMutation.isPending}
              data-testid="button-complete-registration"
            >
              {completeRegistrationMutation.isPending ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                  Setting up...
                </>
              ) : (
                <>
                  Continue to your focus
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}

function MultiSelect({ controlProps, label, options, selected, onChange, testId }: Readonly<{ controlProps: FieldControlProps; label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void; testId: string }>) {
  const [search, setSearch] = useState("");
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : selected.length < 10 ? [...selected, value] : selected);
  const summary = selected.length ? `${selected.length} selected` : label;
  const filteredOptions = options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover onOpenChange={(open) => !open && setSearch("")}><PopoverTrigger asChild><Button {...controlProps} type="button" variant="outline" className={fieldTriggerClassName} data-testid={`select-${testId}`}><span className="min-w-0 truncate">{summary}</span><ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2"><div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} className="pl-9" autoComplete="off" /></div><div className="max-h-56 overflow-y-auto"><div className="space-y-1">{filteredOptions.length ? filteredOptions.map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"><Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} data-testid={`option-${testId}-${option.value.toLowerCase().replace(/\s+/g, "-")}`} /><span>{option.label}</span></label>) : <p className="px-2 py-4 text-center text-sm text-muted-foreground">No matches found.</p>}</div></div></PopoverContent></Popover>;
}
