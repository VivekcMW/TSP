// Email service using Resend integration
import { Resend } from 'resend';

const APP_URL = process.env.APP_URL || "https://www.thesocialpundit.com";
const FROM_NAME = "TheSocialPundit";

// Industry-specific content for welcome emails
interface IndustryContent {
  label: string;
  tagline: string;
  sources: string;
  communityDesc: string;
}

const industryContentMap: Record<string, IndustryContent> = {
  media_advertising: {
    label: "Media & Advertising",
    tagline: "Your Voice in Media & Advertising",
    sources: "AdAge, Digiday, AdWeek, The Drum, and 50+ premium sources",
    communityDesc: "Media & Advertising professionals",
  },
  product_marketing: {
    label: "Product Marketing",
    tagline: "Your Voice in Product Marketing",
    sources: "Product-Led Growth, HubSpot, MarketingProfs, First Round Review, and 40+ top sources",
    communityDesc: "Product Marketing leaders",
  },
  technology_saas: {
    label: "Technology & SaaS",
    tagline: "Your Voice in Tech & SaaS",
    sources: "TechCrunch, The Verge, Wired, Ars Technica, and 50+ tech publications",
    communityDesc: "Technology & SaaS innovators",
  },
  finance_banking: {
    label: "Finance & Banking",
    tagline: "Your Voice in Finance",
    sources: "Financial Times, Bloomberg, WSJ, The Economist, and 40+ financial publications",
    communityDesc: "Finance & Banking professionals",
  },
  healthcare_pharma: {
    label: "Healthcare & Pharma",
    tagline: "Your Voice in Healthcare",
    sources: "STAT News, Fierce Pharma, Healthcare Dive, MedPage Today, and 40+ health sources",
    communityDesc: "Healthcare & Pharma leaders",
  },
  consulting_services: {
    label: "Consulting & Professional Services",
    tagline: "Your Voice in Consulting",
    sources: "McKinsey Insights, HBR, BCG, Consulting Magazine, and 30+ industry sources",
    communityDesc: "Consulting & Services professionals",
  },
  ecommerce_retail: {
    label: "E-commerce & Retail",
    tagline: "Your Voice in Retail",
    sources: "Retail Dive, Modern Retail, eMarketer, RetailWire, and 40+ retail sources",
    communityDesc: "E-commerce & Retail leaders",
  },
  real_estate: {
    label: "Real Estate",
    tagline: "Your Voice in Real Estate",
    sources: "Inman, The Real Deal, Commercial Observer, GlobeSt, and 30+ property sources",
    communityDesc: "Real Estate professionals",
  },
  education_edtech: {
    label: "Education & EdTech",
    tagline: "Your Voice in Education",
    sources: "EdSurge, Inside Higher Ed, Education Week, EdTech Magazine, and 30+ sources",
    communityDesc: "Education & EdTech innovators",
  },
  manufacturing: {
    label: "Manufacturing & Industrial",
    tagline: "Your Voice in Manufacturing",
    sources: "Industry Week, Manufacturing.net, The Manufacturer, and 30+ industrial sources",
    communityDesc: "Manufacturing & Industrial leaders",
  },
  energy_sustainability: {
    label: "Energy & Sustainability",
    tagline: "Your Voice in Energy",
    sources: "GreenBiz, CleanTechnica, Utility Dive, Energy Monitor, and 30+ energy sources",
    communityDesc: "Energy & Sustainability professionals",
  },
  legal_services: {
    label: "Legal Services",
    tagline: "Your Voice in Legal",
    sources: "Law.com, Above the Law, Legal Dive, The American Lawyer, and 30+ legal sources",
    communityDesc: "Legal professionals",
  },
  nonprofit_ngo: {
    label: "Non-profit & NGO",
    tagline: "Your Voice in Non-profit",
    sources: "NonProfit PRO, Chronicle of Philanthropy, Stanford Social Innovation Review, and 25+ sources",
    communityDesc: "Non-profit & NGO leaders",
  },
  government_public: {
    label: "Government & Public Sector",
    tagline: "Your Voice in Public Sector",
    sources: "GovTech, Government Executive, Route Fifty, FCW, and 25+ public sector sources",
    communityDesc: "Government & Public Sector professionals",
  },
  hospitality_travel: {
    label: "Hospitality & Travel",
    tagline: "Your Voice in Hospitality",
    sources: "Skift, Hotel News Now, Travel Weekly, Hospitality Net, and 30+ travel sources",
    communityDesc: "Hospitality & Travel professionals",
  },
  entertainment_media: {
    label: "Entertainment & Media",
    tagline: "Your Voice in Entertainment",
    sources: "Variety, Deadline, The Hollywood Reporter, Billboard, and 40+ entertainment sources",
    communityDesc: "Entertainment & Media professionals",
  },
  telecommunications: {
    label: "Telecommunications",
    tagline: "Your Voice in Telecom",
    sources: "Light Reading, Fierce Telecom, RCR Wireless, Telecom Reseller, and 25+ telecom sources",
    communityDesc: "Telecommunications professionals",
  },
  agriculture: {
    label: "Agriculture & Food",
    tagline: "Your Voice in Agriculture",
    sources: "AgFunder News, Food Dive, AgriPulse, The Counter, and 25+ agriculture sources",
    communityDesc: "Agriculture & Food professionals",
  },
  other: {
    label: "Business",
    tagline: "Your Voice in Business",
    sources: "Harvard Business Review, Fast Company, Inc., Forbes, and 50+ business publications",
    communityDesc: "business professionals",
  },
};

function getIndustryContent(industry?: string): IndustryContent {
  if (industry && industryContentMap[industry]) {
    return industryContentMap[industry];
  }
  return industryContentMap.other;
}

/**
 * Resend client, built from environment configuration.
 *
 * This previously fetched credentials from Replit's connector service using
 * REPL_IDENTITY / WEB_REPL_RENEWAL tokens, which meant email could not work
 * anywhere except inside Replit — including local development. It now reads
 * RESEND_API_KEY and RESEND_FROM_EMAIL directly.
 *
 * Sending requires thesocialpundit.com (or whatever domain RESEND_FROM_EMAIL
 * uses) to be a verified sender in Resend.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "info@thesocialpundit.com";

let cachedClient: Resend | undefined;

export const emailEnabled = Boolean(RESEND_API_KEY);

if (!emailEnabled) {
  console.warn(
    "[email] RESEND_API_KEY is not set — transactional email is disabled. " +
      "Sends will be skipped rather than failing the surrounding request.",
  );
}

function getResendClient(): { client: Resend; fromEmail: string } {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }
  cachedClient ??= new Resend(RESEND_API_KEY);
  return { client: cachedClient, fromEmail: RESEND_FROM_EMAIL };
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWelcomeEmail(
  email: string,
  firstName: string,
  industry?: string
): Promise<EmailResult> {
  try {
    const { client, fromEmail } = getResendClient();
    const industryContent = getIndustryContent(industry);

    const { data, error } = await client.emails.send({
      from: `${FROM_NAME} <${fromEmail}>`,
      to: [email],
      subject: "Welcome to TheSocialPundit - Your Voice, Amplified",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to TheSocialPundit</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f5;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                  
                  <!-- Header with Logo -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1B2A4A 0%, #12203D 100%); padding: 40px 40px 30px 40px; text-align: center;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="text-align: center;">
                            <!-- Logo Icon -->
                            <div style="display: inline-block; background: rgba(255,255,255,0.15); padding: 12px; border-radius: 12px; margin-bottom: 16px;">
                              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#ffffff" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>
                              </svg>
                            </div>
                            <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">TheSocialPundit</h1>
                            <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0 0; font-weight: 400;">${industryContent.tagline}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Welcome Message -->
                  <tr>
                    <td style="padding: 40px 40px 20px 40px;">
                      <h2 style="color: #1C1F21; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">Welcome aboard, ${firstName}!</h2>
                      <p style="color: #52525b; font-size: 16px; line-height: 1.7; margin: 0;">
                        You've just joined an exclusive community of <strong style="color: #1C1F21;">${industryContent.communityDesc}</strong> who are building their thought leadership on LinkedIn and Twitter/X.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- What Makes Us Different -->
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <div style="background: linear-gradient(135deg, #f2f5fa 0%, #e8edf5 100%); border-radius: 10px; padding: 24px; border-left: 4px solid #1B2A4A;">
                        <p style="color: #1B2A4A; font-size: 15px; line-height: 1.6; margin: 0; font-style: italic;">
                          "Go from industry news to published thought leadership in under 5 minutes. Our AI learns your voice and perspective to create posts that sound authentically you."
                        </p>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Benefits Section -->
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <h3 style="color: #1C1F21; font-size: 18px; font-weight: 600; margin: 0 0 20px 0;">What you get with TheSocialPundit:</h3>
                      
                      <!-- Benefit 1 -->
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                        <tr>
                          <td style="width: 48px; vertical-align: top;">
                            <div style="width: 40px; height: 40px; background: #e8edf5; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 13px; font-weight: 700; color: #1B2A4A;">01</span>
                            </div>
                          </td>
                          <td style="padding-left: 12px; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #1C1F21; font-weight: 600; font-size: 15px;">Curated Industry News</p>
                            <p style="margin: 0; color: #71717a; font-size: 14px; line-height: 1.5;">Get hand-picked articles from ${industryContent.sources} matched to your interests.</p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Benefit 2 -->
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                        <tr>
                          <td style="width: 48px; vertical-align: top;">
                            <div style="width: 40px; height: 40px; background: #e8edf5; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 13px; font-weight: 700; color: #1B2A4A;">02</span>
                            </div>
                          </td>
                          <td style="padding-left: 12px; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #1C1F21; font-weight: 600; font-size: 15px;">AI-Powered "Pundit Brain"</p>
                            <p style="margin: 0; color: #71717a; font-size: 14px; line-height: 1.5;">Transform any article into an opinionated, engaging post. Choose your tone: Professional, Bold, or Conversational.</p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Benefit 3 -->
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                        <tr>
                          <td style="width: 48px; vertical-align: top;">
                            <div style="width: 40px; height: 40px; background: #e8edf5; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 13px; font-weight: 700; color: #1B2A4A;">03</span>
                            </div>
                          </td>
                          <td style="padding-left: 12px; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #1C1F21; font-weight: 600; font-size: 15px;">Your Authentic Voice</p>
                            <p style="margin: 0; color: #71717a; font-size: 14px; line-height: 1.5;">Our AI learns your unique perspective and writing style. Every post sounds like you wrote it yourself.</p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Benefit 4 -->
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="width: 48px; vertical-align: top;">
                            <div style="width: 40px; height: 40px; background: #e8edf5; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 13px; font-weight: 700; color: #1B2A4A;">04</span>
                            </div>
                          </td>
                          <td style="padding-left: 12px; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #1C1F21; font-weight: 600; font-size: 15px;">5-Minute Workflow</p>
                            <p style="margin: 0; color: #71717a; font-size: 14px; line-height: 1.5;">Login, browse your curated inbox, generate a post, and publish. Build authority without the time investment.</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- CTA Button -->
                  <tr>
                    <td style="padding: 10px 40px 40px 40px; text-align: center;">
                      <a href="${APP_URL}/dashboard" 
                         style="display: inline-block; background: linear-gradient(135deg, #1B2A4A 0%, #12203D 100%); color: #ffffff; 
                                padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;
                                box-shadow: 0 4px 14px rgba(124, 59, 237, 0.4);">
                        Start Building Your Authority
                      </a>
                      <p style="color: #a1a1aa; font-size: 13px; margin: 16px 0 0 0;">Your curated inbox is waiting for you</p>
                    </td>
                  </tr>
                  
                  <!-- Divider -->
                  <tr>
                    <td style="padding: 0 40px;">
                      <div style="border-top: 1px solid #e4e4e7;"></div>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; text-align: center;">
                      <p style="color: #71717a; font-size: 14px; margin: 0 0 8px 0;">
                        Questions? Just reply to this email - we're here to help.
                      </p>
                      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
                        <a href="${APP_URL}" style="color: #1B2A4A; text-decoration: none; font-weight: 500;">thesocialpundit.com</a>
                        <span style="margin: 0 8px;">|</span>
                        Build your authority in ${industryContent.label}
                      </p>
                    </td>
                  </tr>
                  
                </table>
                
                <!-- Sub-footer -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; margin: 20px auto 0 auto;">
                  <tr>
                    <td style="text-align: center;">
                      <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
                        You received this email because you signed up at TheSocialPundit.
                        <br>
                        <a href="${APP_URL}/unsubscribe" style="color: #a1a1aa; text-decoration: underline;">Unsubscribe</a>
                      </p>
                    </td>
                  </tr>
                </table>
                
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending welcome email:", error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (error: any) {
    console.error("Error sending welcome email:", error);
    return { success: false, error: error.message };
  }
}

export async function testEmailConnection(): Promise<boolean> {
  try {
    getResendClient();
    // Resend doesn't have a ping endpoint, but getting credentials validates the connection
    console.log("Resend connection test: connected successfully");
    return true;
  } catch (error) {
    console.error("Resend connection failed:", error);
    return false;
  }
}

/** Sends Better Auth's single-use verification link. */
export async function sendVerificationEmail(
  email: string,
  name: string,
  verificationUrl: string,
): Promise<void> {
  if (!emailEnabled && process.env.NODE_ENV !== "production") {
    // Local-only delivery capture makes the complete verification flow testable
    // without pretending a message was sent or weakening production behavior.
    console.info(`[email] Development verification link for ${email}: ${verificationUrl}`);
    return;
  }
  try {
    const { client, fromEmail } = getResendClient();
    const { error } = await client.emails.send({
      from: `${FROM_NAME} <${fromEmail}>`,
      to: [email],
      subject: "Verify your TheSocialPundit email address",
      html: `<p>Hi ${name},</p><p>Please verify your email address to finish creating your TheSocialPundit account.</p><p><a href="${verificationUrl}">Verify email address</a></p><p>This link expires in one hour. If you did not create this account, you can safely ignore this message.</p>`,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[email] Resend verification failed; use this development link for ${email}: ${verificationUrl}`, error);
      return;
    }
    throw new Error(`Could not send verification email: ${error instanceof Error ? error.message : "Resend request failed"}`);
  }
}

/** Sends Better Auth's single-use password reset link. */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetUrl: string,
): Promise<void> {
  if (!emailEnabled && process.env.NODE_ENV !== "production") {
    console.info(`[email] Development password reset link for ${email}: ${resetUrl}`);
    return;
  }
  try {
    const { client, fromEmail } = getResendClient();
    const { error } = await client.emails.send({
      from: `${FROM_NAME} <${fromEmail}>`,
      to: [email],
      subject: "Reset your TheSocialPundit password",
      html: `<p>Hi ${name},</p><p>Use the link below to create a new password for your TheSocialPundit account.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires soon. If you did not request it, you can safely ignore this message.</p>`,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[email] Resend password reset failed; use this development link for ${email}: ${resetUrl}`, error);
      return;
    }
    throw new Error(`Could not send password reset email: ${error instanceof Error ? error.message : "Resend request failed"}`);
  }
}
