import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Check, ChevronDown, Search, Sparkles, UserRound } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";

const countries = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", 
  "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Bhutan", "Bolivia", 
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Cambodia", "Cameroon", 
  "Canada", "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cyprus", "Czech Republic", 
  "Denmark", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia", 
  "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Honduras", 
  "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", 
  "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", 
  "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta", "Mauritius", "Mexico", "Moldova", 
  "Monaco", "Mongolia", "Montenegro", "Morocco", "Myanmar", "Nepal", "Netherlands", "New Zealand", 
  "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", 
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", 
  "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", 
  "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Tanzania", "Thailand", "Tunisia", "Turkey", 
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", 
  "Uzbekistan", "Venezuela", "Vietnam", "Zambia", "Zimbabwe"
];

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
    mutationFn: async (data: { firstName: string; lastName: string; industries: string[]; countries: string[] }) => {
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
      completeRegistrationMutation.mutate({ firstName, lastName, industries: industriesSelected, countries: countriesSelected });
    }
  };

  const isValid = industriesSelected.length > 0 && countriesSelected.length > 0;

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-8 sm:px-6">
      <Reveal className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary/15">
            <Sparkles className="h-7 w-7 text-secondary" />
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-secondary">One last step</p>
          <CardTitle className="heading-dashboard text-2xl" data-testid="text-registration-title">Personalize your workspace</CardTitle>
          <CardDescription>
            Tell us what to watch so your recommendations feel relevant from day one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 rounded-[4px] border bg-muted/30 p-3" data-testid="text-saved-name">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10"><UserRound className="h-4 w-4 text-primary" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Your name</p><p className="truncate text-sm font-medium">{[firstName, lastName].filter(Boolean).join(" ")}</p></div>
              <Check className="h-4 w-4 text-success" aria-label="Name saved from signup" />
            </div>
            
            <div className="space-y-2">
              <Label>Industries</Label>
              <MultiSelect label="Select industries" options={industries} selected={industriesSelected} onChange={setIndustriesSelected} testId="industries" />
              <p className="text-xs text-muted-foreground">Select up to 10 industries. Your first selection is used for initial recommendations.</p>
            </div>
            
            <div className="space-y-2">
              <Label>Countries</Label>
              <MultiSelect label="Select countries" options={countries.map((country) => ({ value: country, label: country }))} selected={countriesSelected} onChange={setCountriesSelected} testId="countries" />
              <p className="text-xs text-muted-foreground">Select up to 10 countries to tailor regional recommendations.</p>
            </div>
            
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
                  Continue
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

function MultiSelect({ label, options, selected, onChange, testId }: Readonly<{ label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void; testId: string }>) {
  const [search, setSearch] = useState("");
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : selected.length < 10 ? [...selected, value] : selected);
  const summary = selected.length ? `${selected.length} selected` : label;
  const filteredOptions = options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover onOpenChange={(open) => !open && setSearch("")}><PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-between font-normal" data-testid={`select-${testId}`}>{summary}<ChevronDown className="h-4 w-4 opacity-50" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2"><div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} className="h-9 pl-9" autoComplete="off" /></div><div className="max-h-56 overflow-y-auto"><div className="space-y-1">{filteredOptions.length ? filteredOptions.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"><Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} data-testid={`option-${testId}-${option.value.toLowerCase().replace(/\s+/g, "-")}`} /><span>{option.label}</span></label>) : <p className="px-2 py-4 text-center text-sm text-muted-foreground">No matches found.</p>}</div></div></PopoverContent></Popover>;
}
