import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import SettingsPage from "@/pages/settings";
import ConnectionsPage from "@/pages/analytics";
import PluginsPage from "@/pages/plugins";
import BillingPage from "@/pages/billing";
import { Toaster } from "@/components/ui/toaster";
import { useSettingsDraft } from "../use-settings-draft";
import { StrictMode, useState } from "react";
import { Link, useLocation } from "wouter";

function DraftProbe() {
  const [source, setSource] = useState({ text: "original" });
  const [submitted, setSubmitted] = useState(source);
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft(source);
  return <><input aria-label="Draft" value={draft.text} onChange={(event) => setDraft({ text: event.target.value })} /><button onClick={() => setSource({ text: "remote" })}>Refetch</button><button onClick={() => setSubmitted(draft)}>Submit</button><button onClick={() => acknowledge(submitted)}>Complete</button><output>{dirty ? "dirty" : "clean"}</output></>;
}

const routes: Record<string, () => JSX.Element> = {
  "/standalone/connections": ConnectionsPage,
  "/standalone/publishing": PluginsPage,
  "/standalone/billing": BillingPage,
  "/draft-probe": DraftProbe,
};
function Fixture() {
  const [location, navigate] = useLocation();
  const Page = routes[location] ?? (location === "/dashboard/settings" ? SettingsPage : () => <h1>Outside Settings</h1>);
  return <><nav style={{ position: "sticky", top: 0, zIndex: 101, background: "white" }}>
    <Link href="/dashboard">Leave Settings</Link>
    <Link href="/dashboard/settings?tab=account">Open Settings</Link>
    <button onClick={() => navigate("/dashboard", { replace: true })}>Replace route</button>
  </nav><button id="fixture-refetch" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/profile"] })}>Fixture refetch</button><Page key={location} /><Toaster /></>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><Fixture /></QueryClientProvider></StrictMode>);