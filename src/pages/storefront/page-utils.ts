/** Shared page helpers. */
import { dataService } from "../../services/index.ts";
import type { DataService } from "../../services/DataService.ts";

/** Runs a data-loading callback with uniform error logging — pages render
 * their empty/loading states rather than crashing on service errors. */
export async function dataServiceSafe(fn: (svc: DataService) => Promise<void>): Promise<void> {
  try {
    await fn(dataService());
  } catch (err) {
    console.error("[crowned] data load failed:", err);
  }
}
