import { useState, useEffect, useCallback } from "react";
import { apiGetSettings } from "@/lib/api";

export const PROFILE_UPDATED_EVENT = "bharatscan:profile-updated";

export interface ProfileInfo {
  name: string;
  photo: string | null;
}

/** Broadcast a profile change so every mounted useProfile() consumer (e.g. the Sidebar) refreshes instantly. */
export function notifyProfileUpdated() {
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
}

/**
 * Shared read access to the user's profile (display name + photo), backed by the
 * same /settings API used by the Settings page. Listens for PROFILE_UPDATED_EVENT
 * so other components (Sidebar) stay in sync the moment the user saves changes.
 */
export function useProfile(): ProfileInfo {
  const [name, setName] = useState("Trader");
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGetSettings()
      .then((s) => {
        setName(s["profile:name"]?.trim() || "Trader");
        setPhoto(s["profile:photo"] || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, load);
  }, [load]);

  return { name, photo };
}
