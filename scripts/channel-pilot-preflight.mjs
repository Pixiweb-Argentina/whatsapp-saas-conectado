import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readPilotPreflight } from "../src/features/channels/services/pilot-preflight.ts";

// Deliberately restricted to the explicitly selected new project. No old account.
const PROJECT_URL = "https://bzanbpyzujlogipxvkfn.supabase.co";
const workspace = z.uuid().safeParse(process.argv[2]);
if (!workspace.success || process.env.NEXT_PUBLIC_SUPABASE_URL !== PROJECT_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("PREFLIGHT_CONFIG_INVALID: usá el Supabase nuevo y un workspace UUID explícito.");
  process.exitCode = 1;
} else {
  try {
    const db = createClient(PROJECT_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const report = await readPilotPreflight(db, workspace.data);
    console.log(JSON.stringify(report, null, 2));
    // Readiness gaps are reported as data; only a failed/incomplete inspection
    // fails the command. The report never enables flags or authorizes a send.
    process.exitCode = report.coverage === "complete" ? 0 : 2;
  } catch {
    console.error("CHANNEL_PREFLIGHT_UNAVAILABLE: no se pudo verificar el contexto. No se realizó ningún envío.");
    process.exitCode = 1;
  }
}
