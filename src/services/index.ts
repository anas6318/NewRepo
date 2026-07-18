import { getConfig } from "../lib/env.ts";
import type { DataService } from "./DataService.ts";
import { DemoDataService } from "./demo/DemoDataService.ts";
import { SupabaseDataService } from "./supabase/SupabaseDataService.ts";

let instance: DataService | null = null;

/** Resolves the data service once per session: Supabase when configured,
 * otherwise the clearly-labeled demo service. */
export function dataService(): DataService {
  if (!instance) {
    instance = getConfig().demoMode ? new DemoDataService() : new SupabaseDataService();
  }
  return instance;
}

export function isDemoMode(): boolean {
  return dataService().mode === "demo";
}
