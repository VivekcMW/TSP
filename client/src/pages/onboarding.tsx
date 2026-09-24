import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OnboardingData } from "@/lib/onboarding-choices";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  industry?: string;
  country?: string;
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [saved, setSaved] = useState<OnboardingData | null>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/me"],
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async (data: OnboardingData) => {
      return await apiRequest("POST", "/api/profile/complete-onboarding", data);
    },
    onSuccess: (_response, data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setSaved(data);
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleComplete = (data: OnboardingData) => {
    completeOnboardingMutation.mutate(data);
  };

  return (
    <OnboardingWorkspace
      onComplete={handleComplete}
      isPending={completeOnboardingMutation.isPending}
      userIndustry={user?.industry}
      userCountry={user?.country}
      completed={saved}
    />
  );
}
