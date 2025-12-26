import mailchimp from "@mailchimp/mailchimp_transactional";

const client = mailchimp(process.env.MAILCHIMP_TRANSACTIONAL_API_KEY || "");

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@thesocialpundit.com";
const FROM_NAME = "TheSocialPundit";
const APP_URL = process.env.APP_URL || "https://www.thesocialpundit.com";

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWelcomeEmail(
  email: string,
  firstName: string
): Promise<EmailResult> {
  if (!process.env.MAILCHIMP_TRANSACTIONAL_API_KEY) {
    console.log("Mailchimp API key not configured - skipping welcome email");
    return { success: false, error: "Email service not configured" };
  }

  const message = {
    from_email: FROM_EMAIL,
    from_name: FROM_NAME,
    to: [{ email, name: firstName, type: "to" as const }],
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
    important: true,
    track_opens: true,
    track_clicks: true,
    auto_text: true,
    tags: ["welcome", "onboarding"],
  };

  try {
    const response = await client.messages.send({ message });
    console.log("Welcome email sent to:", email);
    return { 
      success: true, 
      messageId: Array.isArray(response) ? response[0]?._id : undefined 
    };
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
  if (!process.env.MAILCHIMP_TRANSACTIONAL_API_KEY) {
    console.log("Mailchimp API key not configured - skipping password reset email");
    return { success: false, error: "Email service not configured" };
  }

  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;

  const message = {
    from_email: FROM_EMAIL,
    from_name: FROM_NAME,
    to: [{ email, name: firstName, type: "to" as const }],
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
    important: true,
    track_opens: true,
    auto_text: true,
    tags: ["password-reset", "security"],
  };

  try {
    const response = await client.messages.send({ message });
    console.log("Password reset email response:", JSON.stringify(response));
    
    // Check if the email was actually accepted
    if (Array.isArray(response) && response.length > 0) {
      const result = response[0];
      if (result.status === 'rejected' || result.reject_reason) {
        console.error("Password reset email rejected:", result.reject_reason || result.status);
        return { success: false, error: result.reject_reason || 'Email rejected' };
      }
      console.log("Password reset email sent to:", email);
      return { success: true, messageId: result._id };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error("Error sending password reset email:", error);
    return { success: false, error: error.message };
  }
}

export async function testEmailConnection(): Promise<boolean> {
  if (!process.env.MAILCHIMP_TRANSACTIONAL_API_KEY) {
    console.log("Mailchimp API key not configured");
    return false;
  }

  try {
    const response = await client.users.ping();
    console.log("Mailchimp connection test:", response);
    return response === "PONG!";
  } catch (error) {
    console.error("Mailchimp connection failed:", error);
    return false;
  }
}
