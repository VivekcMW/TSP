import { Link2, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

const promises = [
  { icon: UserCheck, title: "You approve every post", body: "Nothing is published under your name unless you publish or schedule it." },
  { icon: Lock, title: "Your data doesn't train AI", body: "Your topics and drafts are used to write for you, not to train models for other users." },
  { icon: ShieldCheck, title: "Analytics only with your OK", body: "We ask before any analytics cookie loads, and you can change your mind in Cookie settings." },
  { icon: Link2, title: "Connect only what you choose", body: "Link a social account when you want to publish directly, and disconnect it any time." },
];

export function Trust() {
  return (
    <section className="bg-card py-20 lg:py-28" data-testid="section-trust">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 max-w-2xl space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Trust</p>
          <h2 className="heading-section">Your name, your rules</h2>
        </Reveal>
        <StaggerGroup className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {promises.map(promise => (
            <StaggerItem key={promise.title} className="rounded-2xl border bg-background p-6">
              <promise.icon className="mb-4 h-7 w-7 text-primary" aria-hidden="true" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">{promise.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{promise.body}</p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
