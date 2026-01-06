import type { Express, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from "passport-google-oauth20";
import { Strategy as LinkedInStrategy } from "passport-linkedin-oauth2";
import bcrypt from "bcryptjs";
import { authStorage } from "./storage";
import connectPg from "connect-pg-simple";
import { pool } from "../../db";
import { z } from "zod";
import { sendPasswordResetEmail } from "../../services/emailService";

const PostgresSessionStore = connectPg(session);

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export function getSession() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set for secure session management");
  }

  const sessionStore = new PostgresSessionStore({
    pool,
    createTableIfMissing: true,
    tableName: "sessions",
  });

  return session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Local Strategy (email/password)
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await authStorage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          if (!user.passwordHash) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || 
      (replitDomain 
        ? `https://${replitDomain}/auth/google/callback`
        : "http://localhost:5000/auth/google/callback");
    console.log("Google OAuth callback URL:", googleCallbackURL);
    
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: googleCallbackURL,
          scope: ["profile", "email"],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(null, false, { message: "No email found in Google profile" });
            }

            // Check if user exists with this Google account
            let user = await authStorage.findUserByOAuthProvider("google", profile.id);
            
            if (!user) {
              // Check if user exists with this email
              user = await authStorage.getUserByEmail(email);
              
              if (user) {
                // Link Google account to existing user
                await authStorage.linkOAuthAccount(user.id, "google", profile.id, accessToken, refreshToken);
              } else {
                // Create new user
                user = await authStorage.createUser({
                  email,
                  firstName: profile.name?.givenName || null,
                  lastName: profile.name?.familyName || null,
                  profileImageUrl: profile.photos?.[0]?.value || null,
                });
                await authStorage.linkOAuthAccount(user.id, "google", profile.id, accessToken, refreshToken);
                // Welcome email is sent after registration is completed with industry selection
              }
            }

            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
    console.log("Google OAuth strategy configured");
  } else {
    console.log("Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }

  // LinkedIn OAuth Strategy
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    const replitDomainLI = process.env.REPLIT_DOMAINS?.split(",")[0];
    const linkedinCallbackURL = process.env.LINKEDIN_CALLBACK_URL || 
      (replitDomainLI 
        ? `https://${replitDomainLI}/auth/linkedin/callback`
        : "http://localhost:5000/auth/linkedin/callback");
    console.log("LinkedIn OAuth callback URL:", linkedinCallbackURL);
    
    passport.use(
      new LinkedInStrategy(
        {
          clientID: process.env.LINKEDIN_CLIENT_ID,
          clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
          callbackURL: linkedinCallbackURL,
          scope: ["openid", "profile", "email"],
        },
        async (accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            console.log("LinkedIn OAuth callback - Profile ID:", profile.id);
            const email = profile.emails?.[0]?.value;
            if (!email) {
              console.error("LinkedIn OAuth: No email found in profile");
              return done(null, false, { message: "No email found in LinkedIn profile" });
            }
            console.log("LinkedIn OAuth: Email found -", email);

            // Check if user exists with this LinkedIn account
            let user = await authStorage.findUserByOAuthProvider("linkedin", profile.id);
            
            if (!user) {
              console.log("LinkedIn OAuth: No existing OAuth link found, checking by email");
              // Check if user exists with this email
              user = await authStorage.getUserByEmail(email);
              
              if (user) {
                console.log("LinkedIn OAuth: Linking to existing user:", user.id);
                // Link LinkedIn account to existing user
                await authStorage.linkOAuthAccount(user.id, "linkedin", profile.id, accessToken, refreshToken);
              } else {
                console.log("LinkedIn OAuth: Creating new user for:", email);
                // Create new user
                user = await authStorage.createUser({
                  email,
                  firstName: profile.name?.givenName || profile.displayName?.split(" ")[0] || null,
                  lastName: profile.name?.familyName || profile.displayName?.split(" ").slice(1).join(" ") || null,
                  profileImageUrl: profile.photos?.[0]?.value || null,
                });
                console.log("LinkedIn OAuth: User created with ID:", user.id);
                await authStorage.linkOAuthAccount(user.id, "linkedin", profile.id, accessToken, refreshToken);
                // Welcome email is sent after registration is completed with industry selection
              }
            } else {
              console.log("LinkedIn OAuth: Existing user found via OAuth link:", user.id);
            }

            return done(null, user);
          } catch (error) {
            console.error("LinkedIn OAuth error:", error);
            return done(error);
          }
        }
      )
    );
    console.log("LinkedIn OAuth strategy configured");
  } else {
    console.log("LinkedIn OAuth not configured - missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET");
  }

  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const user = await authStorage.getUser(id);
      cb(null, user || null);
    } catch (error) {
      cb(error);
    }
  });

  // Google OAuth routes
  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  
  app.get("/auth/google/callback", 
    passport.authenticate("google", { failureRedirect: "/login?error=google_auth_failed" }),
    (req, res) => {
      res.redirect("/dashboard");
    }
  );

  // LinkedIn OAuth routes (for login)
  app.get("/auth/linkedin", (req, res, next) => {
    console.log("LinkedIn OAuth: Initiating authentication");
    console.log("LinkedIn OAuth: Session ID before auth:", req.sessionID);
    
    // Store a custom state value in session to track CSRF
    const stateValue = `li_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    (req.session as any).linkedinOAuthState = stateValue;
    console.log("LinkedIn OAuth: Generated state value:", stateValue);
    
    passport.authenticate("linkedin", { state: stateValue })(req, res, next);
  });
  
  app.get("/auth/linkedin/callback",
    (req, res, next) => {
      // Log all incoming query parameters for debugging
      console.log("LinkedIn OAuth Callback: Full query params:", JSON.stringify(req.query));
      console.log("LinkedIn OAuth Callback: Session ID:", req.sessionID);
      console.log("LinkedIn OAuth Callback: Incoming state from LinkedIn:", req.query.state);
      console.log("LinkedIn OAuth Callback: Stored state in session:", (req.session as any)?.linkedinOAuthState);
      
      // Check for error from LinkedIn
      if (req.query.error) {
        console.error("LinkedIn OAuth Callback: Error from LinkedIn:", {
          error: req.query.error,
          error_description: req.query.error_description,
        });
        return res.redirect(`/login?error=linkedin_auth_failed&reason=${encodeURIComponent(req.query.error_description as string || req.query.error as string)}`);
      }
      
      // Verify state matches (CSRF protection)
      const storedState = (req.session as any)?.linkedinOAuthState;
      const incomingState = req.query.state as string;
      
      if (storedState && incomingState && storedState !== incomingState) {
        console.error("LinkedIn OAuth Callback: STATE MISMATCH!", {
          stored: storedState,
          incoming: incomingState,
        });
        return res.redirect("/login?error=linkedin_auth_failed&reason=state_mismatch");
      }
      
      // Clear the stored state
      if ((req.session as any)?.linkedinOAuthState) {
        delete (req.session as any).linkedinOAuthState;
      }
      
      passport.authenticate("linkedin", (err: any, user: any, info: any) => {
        if (err) {
          console.error("LinkedIn OAuth callback error:", err);
          console.error("LinkedIn OAuth callback error details:", JSON.stringify(err, null, 2));
          return res.redirect("/login?error=linkedin_auth_failed");
        }
        if (!user) {
          console.error("LinkedIn OAuth: No user returned, info:", info);
          return res.redirect("/login?error=linkedin_auth_failed");
        }
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            console.error("LinkedIn OAuth: Login error:", loginErr);
            return res.redirect("/login?error=linkedin_auth_failed");
          }
          console.log("LinkedIn OAuth: Successfully logged in user:", user.id);
          res.redirect("/dashboard");
        });
      })(req, res, next);
    }
  );

  // LinkedIn Analytics OAuth routes (for connecting social account)
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    const replitDomainAnalytics = process.env.REPLIT_DOMAINS?.split(",")[0];
    const linkedinAnalyticsCallbackURL = replitDomainAnalytics 
      ? `https://${replitDomainAnalytics}/auth/linkedin/analytics/callback`
      : "http://localhost:5000/auth/linkedin/analytics/callback";
    console.log("LinkedIn Analytics OAuth callback URL:", linkedinAnalyticsCallbackURL);
    
    passport.use(
      "linkedin-analytics",
      new LinkedInStrategy(
        {
          clientID: process.env.LINKEDIN_CLIENT_ID,
          clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
          callbackURL: linkedinAnalyticsCallbackURL,
          scope: ["openid", "profile", "email"],
          passReqToCallback: true,
        },
        async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            done(null, { accessToken, refreshToken, profile });
          } catch (error) {
            done(error);
          }
        }
      )
    );
    console.log("LinkedIn Analytics OAuth strategy configured");
    
    app.get("/auth/linkedin/analytics", isAuthenticated, (req, res, next) => {
      const userId = (req.user as any)?.id;
      const returnTo = req.query.returnTo as string || req.headers.referer || "/analytics";
      if (userId) {
        (req.session as any).analyticsConnectUserId = userId;
        (req.session as any).analyticsReturnTo = returnTo.includes("/dashboard") ? "/dashboard" : "/analytics";
      }
      passport.authenticate("linkedin-analytics")(req, res, next);
    });
    
    app.get("/auth/linkedin/analytics/callback",
      passport.authenticate("linkedin-analytics", { 
        failureRedirect: "/analytics?error=linkedin_connect_failed",
        session: false,
      }),
      async (req: any, res) => {
        const sessionData = req.session as any;
        const userId = sessionData?.analyticsConnectUserId;
        const returnTo = sessionData?.analyticsReturnTo || "/analytics";
        const oauthData = req.user;
        
        if (sessionData?.analyticsConnectUserId) {
          delete sessionData.analyticsConnectUserId;
        }
        if (sessionData?.analyticsReturnTo) {
          delete sessionData.analyticsReturnTo;
        }
        
        if (!userId || !oauthData?.profile) {
          return res.redirect(`${returnTo}?error=linkedin_connect_failed`);
        }
        
        try {
          const { storage } = await import("../../storage");
          
          const existing = await storage.getSocialAccountByProvider(userId, "linkedin");
          if (existing) {
            await storage.updateSocialAccount(existing.id, {
              accessToken: oauthData.accessToken,
              refreshToken: oauthData.refreshToken || null,
              lastSyncAt: new Date(),
            });
          } else {
            const displayName = oauthData.profile.displayName || 
              `${oauthData.profile.name?.givenName || ''} ${oauthData.profile.name?.familyName || ''}`.trim() ||
              'LinkedIn User';
            
            const account = await storage.createSocialAccount({
              userId,
              provider: "linkedin",
              providerAccountId: oauthData.profile.id,
              accountName: displayName,
              accountHandle: `@${oauthData.profile.id}`,
              accessToken: oauthData.accessToken,
              refreshToken: oauthData.refreshToken || null,
              isActive: true,
              scopes: ["openid", "profile", "email"],
              lastSyncAt: new Date(),
            });
            
            const demoMetrics = generateDemoAnalyticsMetrics("linkedin");
            await storage.createSocialAnalytics({
              userId,
              socialAccountId: account.id,
              provider: "linkedin",
              snapshotDate: new Date(),
              metrics: demoMetrics.metrics,
              topPosts: demoMetrics.topPosts,
            });
          }
          
          res.redirect(`${returnTo}?connected=linkedin`);
        } catch (error) {
          console.error("LinkedIn analytics connection error");
          res.redirect(`${returnTo}?error=linkedin_connect_failed`);
        }
      }
    );
  }

  app.post("/api/auth/register", async (req, res) => {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: validation.error.errors[0]?.message || "Invalid request data" 
        });
      }

      const { email, password, firstName, lastName } = validation.data;

      const existingUser = await authStorage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await authStorage.createUser({
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
      });
      // Welcome email is sent after registration is completed with industry selection

      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to login after registration" });
        }
        return res.json({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: validation.error.errors[0]?.message || "Invalid credentials" 
      });
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Login failed" });
        }
        return res.json({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      req.session.destroy((destroyErr) => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  app.get("/api/login", (req, res) => {
    res.redirect("/login");
  });

  app.get("/api/logout", (req, res) => {
    req.logout((err) => {
      req.session.destroy((destroyErr) => {
        res.clearCookie("connect.sid");
        res.redirect("/");
      });
    });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const validation = forgotPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: validation.error.errors[0]?.message || "Invalid email address",
        });
      }

      const { email } = validation.data;
      const result = await authStorage.setResetToken(email);

      if (result) {
        const firstName = result.user.firstName || "there";
        sendPasswordResetEmail(email, firstName, result.token).catch((err) => {
          console.error("Failed to send password reset email:", err);
        });
      }

      res.json({
        message: "If an account exists with this email, you will receive a password reset link.",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const validation = resetPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: validation.error.errors[0]?.message || "Invalid request",
        });
      }

      const { token, password } = validation.data;

      const user = await authStorage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({
          message: "Invalid or expired reset token. Please request a new password reset.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const updatedUser = await authStorage.resetPassword(token, passwordHash);

      if (!updatedUser) {
        return res.status(400).json({
          message: "Failed to reset password. Please request a new reset link.",
        });
      }

      res.json({ message: "Password reset successfully. You can now log in." });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.get("/api/auth/verify-reset-token", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ valid: false, message: "Token is required" });
      }

      const user = await authStorage.getUserByResetToken(token);
      res.json({ valid: !!user });
    } catch (error) {
      console.error("Verify reset token error:", error);
      res.status(500).json({ valid: false, message: "Failed to verify token" });
    }
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (req.isAuthenticated() && req.user) {
    const user = req.user as any;
    (req as any).user = {
      ...user,
      claims: { sub: user.id },
    };
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};

function generateDemoAnalyticsMetrics(provider: string) {
  const baseFollowers = provider === 'linkedin' ? 2500 : 1800;
  const variance = () => Math.floor(Math.random() * 200) - 100;
  
  const metrics = {
    followers: baseFollowers + variance(),
    following: provider === 'linkedin' ? 450 + variance() : 320 + variance(),
    posts: 24 + Math.floor(Math.random() * 10),
    impressions: 12400 + Math.floor(Math.random() * 3000),
    engagements: 520 + Math.floor(Math.random() * 200),
    engagementRate: parseFloat((4.2 + Math.random() * 2).toFixed(2)),
    likes: 340 + Math.floor(Math.random() * 100),
    comments: 45 + Math.floor(Math.random() * 30),
    shares: 28 + Math.floor(Math.random() * 20),
    clicks: 156 + Math.floor(Math.random() * 50),
    profileViews: provider === 'linkedin' ? 89 + Math.floor(Math.random() * 40) : undefined,
  };
  
  const topPosts = [
    {
      postId: `post_${Date.now()}_1`,
      content: provider === 'linkedin' 
        ? "The future of B2B marketing isn't about more content—it's about better context. Here's what I learned from analyzing 500+ campaigns..."
        : "Hot take: Most SaaS companies are over-engineering their onboarding. Simple wins. Here's why...",
      impressions: 3200 + Math.floor(Math.random() * 1000),
      engagements: 180 + Math.floor(Math.random() * 50),
      likes: 120 + Math.floor(Math.random() * 30),
      comments: 24 + Math.floor(Math.random() * 10),
      shares: 18 + Math.floor(Math.random() * 8),
      postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_2`,
      content: provider === 'linkedin'
        ? "Just shipped a major feature after 3 months of work. The key insight? Listen to users, not just their words, but their behaviors."
        : "Thread: 5 counterintuitive lessons from scaling to $10M ARR. Let's go...",
      impressions: 2800 + Math.floor(Math.random() * 800),
      engagements: 145 + Math.floor(Math.random() * 40),
      likes: 95 + Math.floor(Math.random() * 25),
      comments: 18 + Math.floor(Math.random() * 8),
      shares: 12 + Math.floor(Math.random() * 6),
      postedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_3`,
      content: provider === 'linkedin'
        ? "AI won't replace marketers. But marketers who use AI will replace those who don't. Here's my stack for 2026..."
        : "Unpopular opinion: Most productivity advice is just procrastination in disguise.",
      impressions: 2100 + Math.floor(Math.random() * 600),
      engagements: 98 + Math.floor(Math.random() * 30),
      likes: 72 + Math.floor(Math.random() * 20),
      comments: 12 + Math.floor(Math.random() * 6),
      shares: 8 + Math.floor(Math.random() * 4),
      postedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  
  return { metrics, topPosts };
}
