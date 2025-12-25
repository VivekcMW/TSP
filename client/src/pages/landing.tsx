import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Comparison } from "@/components/landing/comparison";
import { AIPov } from "@/components/landing/ai-pov";
import { UseCases } from "@/components/landing/use-cases";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <Comparison />
        <AIPov />
        <UseCases />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}
