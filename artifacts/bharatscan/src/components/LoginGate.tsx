import { useEffect, useState, useRef, type FormEvent } from "react";

async function attemptLogin(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error ?? "Invalid key" };
  } catch {
    return { ok: false, error: "Could not reach server" };
  }
}

async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  // null = checking, true = authed, false = needs login
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkAuth().then(ok => setAuthed(ok ? true : false));
  }, []);

  useEffect(() => {
    const handler = () => setAuthed(false);
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, []);

  useEffect(() => {
    if (authed === false) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [authed]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const key = inputRef.current?.value ?? "";
    if (!key) return;
    setLoading(true);
    setError(null);
    const result = await attemptLogin(key);
    setLoading(false);
    if (result.ok) {
      setAuthed(true);
    } else {
      setError(result.error ?? "Invalid key");
      if (inputRef.current) inputRef.current.value = "";
      inputRef.current?.focus();
    }
  }

  if (authed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-sm mx-4">
          <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <img src="/favicon.png" alt="BharatScan" className="w-8 h-8" />
              <h1 className="text-xl font-semibold text-foreground">BharatScan</h1>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Enter your API key to continue.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                ref={inputRef}
                type="password"
                placeholder="API key"
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={loading}
              />
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Checking…" : "Unlock"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
