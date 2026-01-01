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
import { sendWelcomeEmail, sendPasswordResetEmail } from "../../services/emailService";

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
    const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || 
      (process.env.NODE_ENV === "production" 
        ? `https://${process.env.REPL_SLUG}.replit.app/auth/google/callback`
        : "http://localhost:5000/auth/google/callback");
    
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
                
                sendWelcomeEmail(email, profile.name?.givenName || "there").catch((err) => {
                  console.error("Failed to send welcome email:", err);
                });
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
    const linkedinCallbackURL = process.env.LINKEDIN_CALLBACK_URL || 
      (process.env.NODE_ENV === "production" 
        ? `https://${process.env.REPL_SLUG}.replit.app/auth/linkedin/callback`
        : "http://localhost:5000/auth/linkedin/callback");
    
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
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(null, false, { message: "No email found in LinkedIn profile" });
            }

            // Check if user exists with this LinkedIn account
            let user = await authStorage.findUserByOAuthProvider("linkedin", profile.id);
            
            if (!user) {
              // Check if user exists with this email
              user = await authStorage.getUserByEmail(email);
              
              if (user) {
                // Link LinkedIn account to existing user
                await authStorage.linkOAuthAccount(user.id, "linkedin", profile.id, accessToken, refreshToken);
              } else {
                // Create new user
                user = await authStorage.createUser({
                  email,
                  firstName: profile.name?.givenName || profile.displayName?.split(" ")[0] || null,
                  lastName: profile.name?.familyName || profile.displayName?.split(" ").slice(1).join(" ") || null,
                  profileImageUrl: profile.photos?.[0]?.value || null,
                });
                await authStorage.linkOAuthAccount(user.id, "linkedin", profile.id, accessToken, refreshToken);
                
                sendWelcomeEmail(email, profile.name?.givenName || "there").catch((err) => {
                  console.error("Failed to send welcome email:", err);
                });
              }
            }

            return done(null, user);
          } catch (error) {
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

  // LinkedIn OAuth routes
  app.get("/auth/linkedin", passport.authenticate("linkedin"));
  
  app.get("/auth/linkedin/callback",
    passport.authenticate("linkedin", { failureRedirect: "/login?error=linkedin_auth_failed" }),
    (req, res) => {
      res.redirect("/dashboard");
    }
  );

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

      sendWelcomeEmail(email, firstName || "there").catch((err) => {
        console.error("Failed to send welcome email:", err);
      });

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
