import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { resolveGate } from "@/lib/gate";
import { SettingsShell } from "../settings-shell";
import { InvitationSettings } from "../invitation-settings";
import { PublicRoutes } from "@/components/public-routes";

function Fixture() {
  const [location] = useLocation();
  if (location === "/standalone") return <InvitationSettings />;
  if (location.startsWith("/dashboard")) return <><Link href="/dashboard">Leave Settings</Link>{location === "/dashboard/settings" ? <SettingsShell /> : <h1>Outside Settings</h1>}</>;
  const gate = resolveGate({ authLoaded: true, signedIn: false, path: location, me: { status: "error", registrationCompleted: null }, profile: { status: "error", onboardingStatus: null } });
  return gate === "public" ? <PublicRoutes /> : <h1>Not public</h1>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><HelmetProvider><Fixture /></HelmetProvider></QueryClientProvider></StrictMode>);