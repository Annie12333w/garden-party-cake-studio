import { useEffect, useState } from "react";
import { api } from "./api";
import type { Menu } from "./types";

// The menu rarely changes, so it is fetched once per page load and shared.
let cache: Menu | null = null;
let inflight: Promise<Menu> | null = null;

export function loadMenu(force = false): Promise<Menu> {
  if (cache && !force) return Promise.resolve(cache);
  if (!inflight || force) {
    inflight = api.menu().then((m) => {
      cache = m;
      inflight = null;
      return m;
    });
    inflight.catch(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useMenu() {
  const [menu, setMenu] = useState<Menu | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMenu()
      .then((m) => live && setMenu(m))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);
  return { menu, error };
}
