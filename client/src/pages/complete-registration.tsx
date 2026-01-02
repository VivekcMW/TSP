import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Sparkles } from "lucide-react";

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
}

export default function CompleteRegistrationPage({ existingFirstName, existingLastName }: CompleteRegistrationProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(existingFirstName || "");
  const [lastName, setLastName] = useState(existingLastName || "");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");

  const completeRegistrationMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; industry: string; country: string }) => {
      return await apiRequest("POST", "/api/complete-registration", data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Welcome!",
        description: "Let's set up your profile.",
      });
      setLocation("/onboarding");
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (firstName && lastName && industry && country) {
      completeRegistrationMutation.mutate({ firstName, lastName, industry, country });
    }
  };

  const isValid = firstName.trim() && lastName.trim() && industry && country;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-registration-title">
            Complete Your Profile
          </CardTitle>
          <CardDescription>
            Just a few details to personalize your experience.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-last-name"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger data-testid="select-industry">
                  <SelectValue placeholder="Select your industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((ind) => (
                    <SelectItem key={ind.value} value={ind.value} data-testid={`option-industry-${ind.value}`}>
                      {ind.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger data-testid="select-country">
                  <SelectValue placeholder="Select your country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c} value={c} data-testid={`option-country-${c.toLowerCase().replace(/\s+/g, '-')}`}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    </div>
  );
}
