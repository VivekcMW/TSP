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
  "United States", "United Kingdom", "Canada", "Australia", "Germany",
  "France", "India", "Singapore", "United Arab Emirates", "Netherlands",
  "Sweden", "Switzerland", "Japan", "South Korea", "Brazil",
  "Mexico", "Spain", "Italy", "Ireland", "New Zealand"
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
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  const completeRegistrationMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; city: string; country: string }) => {
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
    if (firstName && lastName && city && country) {
      completeRegistrationMutation.mutate({ firstName, lastName, city, country });
    }
  };

  const isValid = firstName.trim() && lastName.trim() && city.trim() && country;

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
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="San Francisco"
                data-testid="input-city"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger data-testid="select-country">
                  <SelectValue placeholder="Select a country" />
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
