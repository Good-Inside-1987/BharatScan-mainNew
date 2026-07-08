import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Plug, PlugZap, Loader2, Circle, RefreshCw, LogOut } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BrokerConnection {
  id: string;
  broker_name: string;
  display_name: string;
  status: "connected" | "expired" | "disconnected";
  token_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

const listConnections = () =>
  apiFetch<BrokerConnection[]>("/api/broker-connections");

const createConnection = (body: {
  broker_name: string;
  display_name: string;
  api_key: string;
  client_code: string;
  pin: string;
}) => apiFetch<BrokerConnection>("/api/broker-connections", { method: "POST", body: JSON.stringify(body) });

const deleteConnection = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/broker-connections/${id}`, { method: "DELETE" });

const connectBroker = (id: string, totp_code: string) =>
  apiFetch<{ ok: boolean; token_generated_at: string }>(
    `/api/broker-connections/${id}/connect`,
    { method: "POST", body: JSON.stringify({ totp_code }) }
  );

const disconnectBroker = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/broker-connections/${id}/disconnect`, { method: "POST" });

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function sessionValidUntil(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  d.setHours(d.getHours() + 24);
  return formatTime(d.toISOString());
}

function StatusDot({ status }: { status: BrokerConnection["status"] }) {
  const cls =
    status === "connected"
      ? "text-emerald-400"
      : status === "expired"
      ? "text-amber-400"
      : "text-muted-foreground/40";
  const label =
    status === "connected" ? "Connected" : status === "expired" ? "Expired" : "Disconnected";
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${cls}`}>
      <Circle size={7} fill="currentColor" />
      {label}
    </span>
  );
}

// ── Add Broker Form ────────────────────────────────────────────────────────────

interface AddFormState {
  display_name: string;
  api_key: string;
  client_code: string;
  pin: string;
}

const EMPTY_FORM: AddFormState = { display_name: "Angel One", api_key: "", client_code: "", pin: "" };

function AddBrokerForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);

  const mutation = useMutation({
    mutationFn: () =>
      createConnection({
        broker_name: "angel_one",
        display_name: form.display_name || "Angel One",
        api_key: form.api_key,
        client_code: form.client_code,
        pin: form.pin,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broker-connections"] });
      toast.success("Broker added. Enter a TOTP to connect.");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const set = (k: keyof AddFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card className="border border-border/60 bg-card/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plug size={15} className="text-primary" />
          Add Angel One Connection
        </h3>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Display Name</span>
          <Input
            value={form.display_name}
            onChange={set("display_name")}
            placeholder="Angel One"
            className="h-8 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">API Key</span>
          <Input
            value={form.api_key}
            onChange={set("api_key")}
            placeholder="Your SmartAPI API key"
            autoComplete="off"
            className="h-8 text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Client Code</span>
          <Input
            value={form.client_code}
            onChange={set("client_code")}
            placeholder="e.g. A123456"
            autoComplete="off"
            className="h-8 text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">PIN</span>
          <Input
            type="password"
            value={form.pin}
            onChange={set("pin")}
            placeholder="4-digit login PIN"
            autoComplete="new-password"
            className="h-8 text-sm"
          />
        </label>
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Credentials are encrypted with AES-256-GCM before storage and never leave the server.
      </p>

      <Button
        size="sm"
        className="w-full h-8"
        disabled={!form.api_key || !form.client_code || !form.pin || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
        Save Credentials
      </Button>
    </Card>
  );
}

// ── Broker Card ────────────────────────────────────────────────────────────────

function BrokerCard({ broker }: { broker: BrokerConnection }) {
  const qc = useQueryClient();
  const [totp, setTotp] = useState("");

  const connectMut = useMutation({
    mutationFn: () => connectBroker(broker.id, totp),
    onSuccess: () => {
      setTotp("");
      void qc.invalidateQueries({ queryKey: ["broker-connections"] });
      toast.success(`${broker.display_name} connected successfully.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectBroker(broker.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broker-connections"] });
      toast.info(`${broker.display_name} disconnected.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteConnection(broker.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broker-connections"] });
      toast.success("Broker removed.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const needsTotp = broker.status === "disconnected" || broker.status === "expired";

  return (
    <Card className="border border-border/50 bg-card/60 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold truncate">{broker.display_name}</p>
          <StatusDot status={broker.status} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {broker.status === "connected" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Disconnect"
              disabled={disconnectMut.isPending}
              onClick={() => disconnectMut.mutate()}
            >
              {disconnectMut.isPending
                ? <Loader2 size={13} className="animate-spin" />
                : <LogOut size={13} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-400"
            title="Remove"
            disabled={deleteMut.isPending}
            onClick={() => deleteMut.mutate()}
          >
            {deleteMut.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : <Trash2 size={13} />}
          </Button>
        </div>
      </div>

      {/* Time info */}
      {broker.token_generated_at && (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground/70">
          <div>
            <span className="block font-medium text-muted-foreground/50 uppercase tracking-wide text-[9px] mb-0.5">Last Connected</span>
            {formatTime(broker.token_generated_at)}
          </div>
          <div>
            <span className="block font-medium text-muted-foreground/50 uppercase tracking-wide text-[9px] mb-0.5">Session Valid Until</span>
            {sessionValidUntil(broker.token_generated_at)}
          </div>
        </div>
      )}

      {/* TOTP row — shown when disconnected or expired */}
      {needsTotp && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit TOTP"
            maxLength={6}
            className="h-8 text-sm font-mono w-32 shrink-0"
          />
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={totp.length < 6 || connectMut.isPending}
            onClick={() => connectMut.mutate()}
          >
            {connectMut.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : broker.status === "expired"
              ? <><RefreshCw size={13} /> Reconnect</>
              : <><PlugZap size={13} /> Connect</>}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BrokerConnections() {
  const [showAdd, setShowAdd] = useState(false);

  const { data: brokers = [], isLoading, error } = useQuery({
    queryKey: ["broker-connections"],
    queryFn: listConnections,
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
        <div>
          <h1 className="text-base font-semibold">Broker Connections</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage broker API credentials — stored encrypted, never exposed.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowAdd((v) => !v)}>
          <Plus size={14} />
          Add Broker
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {/* Add form */}
        {showAdd && <AddBrokerForm onClose={() => setShowAdd(false)} />}

        {/* States */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="text-sm text-red-400 py-8 text-center">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && brokers.length === 0 && !showAdd && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/50">
            <Plug size={32} strokeWidth={1.5} />
            <p className="text-sm">No broker connections yet.</p>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add your first broker
            </Button>
          </div>
        )}

        {/* Broker list */}
        {!isLoading && brokers.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {brokers.map((b) => (
              <BrokerCard key={b.id} broker={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
