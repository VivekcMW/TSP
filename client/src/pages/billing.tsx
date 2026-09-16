import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { BillingPanel } from "@/pages/settings";

export default function BillingPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={CreditCard} title="Billing" subtitle="Manage your plan, payments, and subscription." />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          <BillingPanel />
        </div>
      </main>
    </div>
  );
}