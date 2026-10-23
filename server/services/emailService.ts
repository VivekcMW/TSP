// Compatibility entry point; all delivery goes through the authoritative service.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import { emailTemplates, sendAppEmail } from "./email";
export { sendVerificationEmail, sendPasswordResetEmail } from "./email";
export const emailEnabled = Boolean(process.env.RESEND_API_KEY);

const industryLabels: Record<string, string> = {
  media_advertising: "Media & Advertising",
  product_marketing: "Product Marketing",
  technology_saas: "Technology & SaaS",
  finance_banking: "Finance & Banking",
  healthcare_pharma: "Healthcare & Pharma",
  consulting_services: "Consulting & Professional Services",
  ecommerce_retail: "E-commerce & Retail",
  real_estate: "Real Estate",
  education_edtech: "Education & EdTech",
  manufacturing: "Manufacturing & Industrial",
  energy_sustainability: "Energy & Sustainability",
  legal_services: "Legal Services",
  nonprofit_ngo: "Non-profit & NGO",
  government_public: "Government & Public Sector",
  hospitality_travel: "Hospitality & Travel",
  entertainment_media: "Entertainment & Media",
  telecommunications: "Telecommunications",
  agriculture: "Agriculture & Food",
  other: "Business",
};

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWelcomeEmail(
  email: string,
  firstName: string,
  industry?: string,
): Promise<EmailResult> {
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return { success: false, error: "Recipient account unavailable" };
    const result = await sendAppEmail({
      type: "welcome",
      userId: user.id,
      recipient: email,
      recipientName: firstName,
      dedupeKey: `welcome:${user.id}`,
      ...emailTemplates.welcome(industryLabels[industry ?? "other"] ?? industryLabels.other),
    });
    return { success: !!result.messageId, messageId: result.messageId };
  } catch {
    console.error("[email] Welcome email was not confirmed delivered");
    return { success: false, error: "Welcome email was not confirmed delivered" };
  }
}

/** Configuration presence only, never a claim of provider connectivity. */
export async function testEmailConnection(): Promise<boolean> {
  return emailEnabled;
}
