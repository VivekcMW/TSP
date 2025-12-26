// Email service using Resend integration
import { Resend } from 'resend';

const APP_URL = process.env.APP_URL || "https://thesocialpundit.com";
const FROM_NAME = "TheSocialPundit";

// Once thesocialpundit.com is verified in Resend, emails will work automatically
// The fromEmail comes from the Resend connector settings

// Resend integration - get credentials from Replit connector
let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return {
    apiKey: connectionSettings.settings.api_key, 
    fromEmail: connectionSettings.settings.from_email
  };
}

// Get a fresh Resend client (never cache - tokens can expire)
async function getResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWelcomeEmail(
  email: string,
  firstName: string
): Promise<EmailResult> {
  try {
    const { client, fromEmail } = await getResendClient();

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
                    <td style="background: linear-gradient(135deg, #7C3BED 0%, #6316E9 100%); padding: 40px 40px 30px 40px; text-align: center;">
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
                            <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0 0; font-weight: 400;">Your Voice in Media & Advertising</p>
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
                        You've just joined an exclusive community of <strong style="color: #1C1F21;">Media & Advertising professionals</strong> who are building their thought leadership on LinkedIn and Twitter/X.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- What Makes Us Different -->
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 10px; padding: 24px; border-left: 4px solid #7C3BED;">
                        <p style="color: #6b21a8; font-size: 15px; line-height: 1.6; margin: 0; font-style: italic;">
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
                            <div style="width: 40px; height: 40px; background: #f3e8ff; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 18px;">&#128218;</span>
                            </div>
                          </td>
                          <td style="padding-left: 12px; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #1C1F21; font-weight: 600; font-size: 15px;">Curated Industry News</p>
                            <p style="margin: 0; color: #71717a; font-size: 14px; line-height: 1.5;">Get hand-picked articles from AdAge, Digiday, AdWeek, and 50+ premium sources matched to your interests.</p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Benefit 2 -->
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                        <tr>
                          <td style="width: 48px; vertical-align: top;">
                            <div style="width: 40px; height: 40px; background: #f3e8ff; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 18px;">&#129302;</span>
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
                            <div style="width: 40px; height: 40px; background: #f3e8ff; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 18px;">&#127908;</span>
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
                            <div style="width: 40px; height: 40px; background: #f3e8ff; border-radius: 10px; text-align: center; line-height: 40px;">
                              <span style="font-size: 18px;">&#9889;</span>
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
                         style="display: inline-block; background: linear-gradient(135deg, #7C3BED 0%, #6316E9 100%); color: #ffffff; 
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
                        <a href="${APP_URL}" style="color: #7C3BED; text-decoration: none; font-weight: 500;">thesocialpundit.com</a>
                        <span style="margin: 0 8px;">|</span>
                        Build your authority in Media & Advertising
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

    console.log("Welcome email sent to:", email);
    return { success: true, messageId: data?.id };
  } catch (error: any) {
    console.error("Error sending welcome email:", error);
    return { success: false, error: error.message };
  }
}

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetToken: string
): Promise<EmailResult> {
  try {
    const { client, fromEmail } = await getResendClient();
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;

    const { data, error } = await client.emails.send({
      from: `${FROM_NAME} <${fromEmail}>`,
      to: [email],
      subject: "Reset Your TheSocialPundit Password",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #7C3AED; margin: 0;">TheSocialPundit</h1>
          </div>
          
          <h2 style="color: #1a1a1a;">Password Reset Request</h2>
          
          <p>Hi ${firstName},</p>
          
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background: #7C3AED; color: white; padding: 14px 28px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: 600;">
              Reset Password
            </a>
          </div>
          
          <p style="color: #666;">This link will expire in <strong>1 hour</strong>.</p>
          
          <div style="background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; border-radius: 4px;">
            <strong>Security Notice:</strong><br>
            If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
          </div>
          
          <p style="font-size: 12px; color: #999;">
            Or copy and paste this URL into your browser:<br>
            <span style="color: #7C3AED; word-break: break-all;">${resetUrl}</span>
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 12px; color: #999; text-align: center;">
            TheSocialPundit - Build your authority in Media & Advertising
            <br>
            <a href="${APP_URL}" style="color: #7C3AED;">www.thesocialpundit.com</a>
          </p>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending password reset email:", error);
      return { success: false, error: error.message };
    }

    console.log("Password reset email sent to:", email);
    return { success: true, messageId: data?.id };
  } catch (error: any) {
    console.error("Error sending password reset email:", error);
    return { success: false, error: error.message };
  }
}

export async function testEmailConnection(): Promise<boolean> {
  try {
    const { client } = await getResendClient();
    // Resend doesn't have a ping endpoint, but getting credentials validates the connection
    console.log("Resend connection test: connected successfully");
    return true;
  } catch (error) {
    console.error("Resend connection failed:", error);
    return false;
  }
}
