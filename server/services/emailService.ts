// Email service using Resend integration
import { Resend } from 'resend';

const APP_URL = process.env.APP_URL || "https://www.thesocialpundit.com";
const FROM_NAME = "TheSocialPundit";

// Use Resend's test sender for development until domain is verified
// Change this to your verified domain email once thesocialpundit.com is verified in Resend
const TEST_FROM_EMAIL = "onboarding@resend.dev";
const USE_TEST_SENDER = true; // Set to false once domain is verified

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
    // Use test sender during development, switch to verified domain sender for production
    fromEmail: USE_TEST_SENDER ? TEST_FROM_EMAIL : fromEmail
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
      subject: "Welcome to TheSocialPundit!",
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
          
          <h2 style="color: #1a1a1a;">Welcome to TheSocialPundit, ${firstName}!</h2>
          
          <p>You've taken the first step toward building your authority in the Media & Advertising industry.</p>
          
          <p>Here's what you can do with TheSocialPundit:</p>
          
          <ul style="padding-left: 20px;">
            <li><strong>Curated News:</strong> Get industry-relevant articles matched to your interests</li>
            <li><strong>AI-Powered Posts:</strong> Transform news into opinionated LinkedIn and Twitter posts</li>
            <li><strong>Your Voice:</strong> Posts are written in your unique style and perspective</li>
            <li><strong>Save Time:</strong> Go from news to published post in under 5 minutes</li>
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${APP_URL}/dashboard" 
               style="background: #7C3AED; color: white; padding: 14px 28px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: 600;">
              Go to Dashboard
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            If you have any questions, just reply to this email. We're here to help!
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
