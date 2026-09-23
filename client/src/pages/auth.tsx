import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { FaLinkedin } from "react-icons/fa";
import { SiGoogle } from "react-icons/si";
import { ArrowRight, Eye, EyeOff, Rss, Sparkles, ShieldCheck, Zap } from "lucide-react";
import type { ComponentType } from "react";

type SocialProvider = "google" | "linkedin" | "twitter";
type ProviderAvailability = Record<SocialProvider, boolean>;

// X/Twitter OAuth redirect URIs were never registered, so it's left out of
// this list entirely rather than shown disabled — hidden from sign-in/sign-up.
const providerMeta: Array<{ id: SocialProvider; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "google", label: "Google", icon: SiGoogle },
  { id: "linkedin", label: "LinkedIn", icon: FaLinkedin },
];

export function SignInPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    const result = await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) return setError(result.error.message || "Unable to sign in.");
    setLocation("/dashboard");
  }
  async function requestReset() {
    if (resetPending) return;
    if (!email) return setError("Enter your email first, then try again.");
    setResetPending(true); setError(""); setResetSent(false);
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      if (result.error) return setError("Unable to send the reset email. Please try again.");
      setResetSent(true);
    } catch {
      setError("Unable to send the reset email. Check your connection and try again.");
    } finally {
      setResetPending(false);
    }
  }
  return <AuthCard title="Welcome back" description="Sign in to TheSocialPundit"><SocialLogin /><Divider /><form className="space-y-4" onSubmit={submit}><Field id="signin-email" label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" /><Field id="signin-password" label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" /><div className="-mt-2 flex justify-end"><button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={requestReset} disabled={resetPending}>{resetPending ? "Sending reset link…" : "Forgot password?"}</button></div><Message text={error} />{resetSent && <p className="text-sm text-success">If an account exists for that email, a reset link is on its way.</p>}<Button className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button><p className="text-sm text-center text-muted-foreground">New here? <Link className="text-primary underline" href="/sign-up">Create an account</Link></p></form></AuthCard>;
}

export function SignUpPage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    const result = await authClient.signUp.email({ name, email, password, callbackURL: `${window.location.origin}/complete-registration` });
    setPending(false);
    if (result.error) return setError(result.error.message || "Unable to create your account.");
    setLocation("/verify-email");
  }
  return <AuthCard title="Create your account" description="Verify your email to get started with TheSocialPundit"><SocialLogin /><Divider /><form className="space-y-4" onSubmit={submit}><Field id="signup-name" label="Full name" value={name} onChange={setName} autoComplete="name" /><Field id="signup-email" label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" /><Field id="signup-password" label="Password" value={password} onChange={setPassword} type="password" autoComplete="new-password" hint="At least 8 characters" /><Message text={error} /><Button className="w-full" disabled={pending}>{pending ? "Creating account…" : "Create account"}</Button><p className="text-sm text-center text-muted-foreground">Already have an account? <Link className="text-primary underline" href="/sign-in">Sign in</Link></p></form></AuthCard>;
}

export function VerifyEmailPage() {
  return <AuthCard title="Check your inbox" description="We sent a verification link to your email address. Open it to activate your account, then sign in."><Button asChild className="w-full"><Link href="/sign-in">Go to sign in</Link></Button></AuthCard>;
}

export function ResetPasswordPage() {
  const [token, setToken] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const tokens = query.getAll("token");
    // Treat ambiguous/error links as invalid; never render an untrusted value.
    return !query.has("error") && tokens.length === 1 && /^[A-Za-z0-9_-]{1,512}$/.test(tokens[0]) ? tokens[0] : null;
  });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    // Keep the token only in component memory, not browser history, storage,
    // subsequent referrers, or callback URLs. Reload requires reopening the email.
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (success) successRef.current?.focus();
    else if (error || !token) messageRef.current?.focus();
  }, [error, success, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !token || success) return;
    setError("");
    if (password.length < 8 || password.length > 128) return setError("Use a password between 8 and 128 characters.");
    if (password !== confirmation) return setError("Passwords do not match.");
    submitting.current = true;
    setPending(true);
    try {
      // Deliberately ignore callbackURL/redirectTo/next supplied in the URL.
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") setToken(null);
        else setError("Unable to reset your password. Please try again or request a new link.");
        return;
      }
      if (!result.data?.status) {
        setError("Unable to confirm the password reset. Please try again or request a new link.");
        return;
      }
      setSuccess(true);
      setToken(null);
      setPassword("");
      setConfirmation("");
    } catch {
      // SDK/network errors may contain request details. Never log or display them.
      setError("Unable to reset your password. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  let content: React.ReactNode;
  if (success) {
    content = <div className="space-y-4">
      <output ref={successRef} tabIndex={-1} className="block text-sm text-success">Your password has been reset. You can now sign in with your new password.</output>
      <Button asChild className="w-full"><Link href="/sign-in">Go to sign in</Link></Button>
    </div>;
  } else if (!token) {
    content = <div className="space-y-4">
      <p ref={messageRef} tabIndex={-1} role="alert" className="text-sm text-destructive">This reset link is invalid or has expired. Request a new link from the sign-in page.</p>
      <Button asChild className="w-full"><Link href="/sign-in">Request a new reset link</Link></Button>
    </div>;
  } else {
    content = <form className="space-y-4" onSubmit={submit} noValidate aria-busy={pending} aria-label="Reset password">
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">New password</legend>
        <div className="space-y-2">
          <Label htmlFor="reset-password">New password</Label>
          <Input id="reset-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="reset-password-hint reset-password-error" />
          <p id="reset-password-hint" className="text-xs text-muted-foreground">Use 8–128 characters. Reopen the email link if you reload this page.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirmation">Confirm new password</Label>
          <Input id="reset-confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-describedby="reset-password-error" />
        </div>
        <Button type="submit" className="w-full">{pending ? "Resetting password…" : "Reset password"}</Button>
      </fieldset>
      <p id="reset-password-error" ref={messageRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>
      <Link className="block text-center text-sm text-primary underline" href="/sign-in">Back to sign in</Link>
    </form>;
  }
  return <AuthCard title="Reset your password" description="Choose a new password for your account.">{content}</AuthCard>;
}

function AuthCard({ title, description, children }: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
  return <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]">
    <BrandPanel />
    <main className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
      <div className="w-full max-w-md">
      <MobileBrand />
      <Card className="w-full max-w-md border-border/70 shadow-sm"><CardHeader className="pb-4"><h1 className="heading-dashboard text-2xl">{title}</h1><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>
      </div>
    </main>
  </div>;
}

function BrandPanel() {
  return <aside className="relative hidden overflow-hidden bg-surface-ink text-surface-ink-foreground lg:flex lg:min-h-[100dvh] lg:flex-col lg:justify-between lg:p-12 xl:p-16">
    <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-secondary/10 blur-3xl" />
    <div className="relative">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-secondary text-secondary-foreground"><Zap className="h-5 w-5 fill-current" /></span><span>TheSocialPundit</span></div>
      <div className="mt-24 max-w-xl xl:mt-32"><p className="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-secondary">Your professional signal</p><h2 className="font-serif text-4xl font-semibold leading-[1.08] tracking-tight xl:text-6xl">Turn what you know into what people remember.</h2><p className="mt-6 max-w-lg text-base leading-relaxed text-surface-ink-foreground/70 xl:text-lg">Stay close to the conversations shaping your industry, then publish a point of view that sounds like you.</p></div>
    </div>
    <div className="relative mt-12 max-w-xl">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-surface-ink-foreground/55"><span>From signal</span><ArrowRight className="h-3.5 w-3.5" /><span>to influence</span></div>
      <div className="grid gap-2 sm:grid-cols-3"><PreviewStep icon={Rss} label="Industry signal" text="A story worth noticing" /><PreviewStep icon={Sparkles} label="Your perspective" text="A sharper point of view" /><PreviewStep icon={ArrowRight} label="Published" text="A voice people remember" /></div>
      <div className="mt-6 flex items-center gap-2 text-xs text-surface-ink-foreground/45"><ShieldCheck className="h-3.5 w-3.5 text-secondary" />Personalized to your industry, interests, and publishing rhythm.</div>
    </div>
  </aside>;
}

function MobileBrand() {
  return <div className="mb-6 flex items-center gap-2 lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-primary text-primary-foreground"><Zap className="h-4 w-4 fill-current" /></span><div><p className="text-sm font-semibold">TheSocialPundit</p><p className="text-xs text-muted-foreground">Your professional signal</p></div></div>;
}

function PreviewStep({ icon: Icon, label, text }: Readonly<{ icon: ComponentType<{ className?: string }>; label: string; text: string }>) {
  return <div className="rounded-[4px] border border-surface-ink-foreground/15 bg-surface-ink-foreground/[0.06] p-3"><Icon className="mb-5 h-4 w-4 text-secondary" /><p className="text-[10px] font-semibold uppercase tracking-wide text-surface-ink-foreground/55">{label}</p><p className="mt-1 text-xs leading-relaxed text-surface-ink-foreground/85">{text}</p></div>;
}
function Field({ id, label, value, onChange, type = "text", hint, autoComplete }: Readonly<{ id: string; label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string; autoComplete?: string }>) { const [visible, setVisible] = useState(false); const isPassword = type === "password"; const inputType = isPassword && visible ? "text" : type; return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="relative"><Input id={id} required type={inputType} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className={isPassword ? "pr-10" : undefined} />{isPassword && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}</div>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>; }
function Message({ text }: { text: string }) { return text ? <p role="alert" className="text-sm text-destructive">{text}</p> : null; }

function SocialLogin() {
  const { data: providers } = useQuery<ProviderAvailability>({ queryKey: ["/api/auth-providers"] });
  const loaded = providers !== undefined;
  const anyEnabled = loaded && providerMeta.some(({ id }) => providers[id] === true);
  
  const getButtonStyle = (id: SocialProvider) => {
    if (id === "google") {
      return "bg-white hover:bg-gray-50 border-gray-300 text-gray-700 hover:shadow-md transition-shadow";
    } else if (id === "linkedin") {
      return "bg-[#0A66C2] hover:bg-[#085399] border-[#0A66C2] text-white hover:shadow-md transition-shadow";
    }
    return "bg-white hover:bg-gray-50 border-gray-300 text-gray-700";
  };

  return <div className="space-y-3"><div><p className="text-sm font-medium">Sign in faster</p><p className="mt-1 text-xs text-muted-foreground">Choose Google or LinkedIn, or continue with email below.</p></div><div className="grid grid-cols-2 gap-3">{providerMeta.map(({ id, label, icon: Icon }) => {
    const enabled = providers?.[id] === true;
    const status = getProviderStatus(loaded, enabled);
    const isDisabled = !enabled;
    return <Button key={id} type="button" className={`h-11 w-full font-medium flex items-center justify-center gap-2 ${getButtonStyle(id)} ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`} disabled={isDisabled} title={enabled ? `Continue with ${label}` : `${label} login is ${status.toLowerCase()}`} aria-label={enabled ? `Continue with ${label}` : `${label} login is ${status.toLowerCase()}`} onClick={() => { if (enabled) authClient.signIn.social({ provider: id, callbackURL: `${window.location.origin}/dashboard` }); }} data-testid={`button-social-${id}`}><Icon className="h-5 w-5" /><span className="text-sm">{label}</span></Button>;
  })}</div>{loaded && !anyEnabled && <p className="text-center text-xs text-muted-foreground">Social login will activate when credentials are configured. Email login is ready now.</p>}</div>;
}

function getProviderStatus(loaded: boolean, enabled: boolean): string {
  if (!loaded) return "Checking availability…";
  return enabled ? "Available now" : "Coming soon";
}

function Divider() {
  return <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" /><span>Or continue with email</span><div className="h-px flex-1 bg-border" /></div>;
}
