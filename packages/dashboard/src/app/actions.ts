"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiClientError, getClient } from "@/lib/api";
import type {
  CreateTestBody,
  PatchTestBody,
  UrlTargeting,
  Variant,
} from "@/lib/types";

/**
 * Server actions — the only place the dashboard mutates. Each wraps one control
 * route, validates/parses the form, and returns a `FormState` the client form
 * renders (success banner or the API's stable error `code`). Mutations
 * `revalidatePath` so the affected Server Components refetch.
 *
 * The write key never leaves here: forms POST to these actions, the action calls
 * the API server-side. The browser never sees a key or a raw fetch.
 */
export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: string;
}

const EMPTY: FormState = {};

/** A2 — create a test, then redirect to its detail page. */
export async function createTestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let body: CreateTestBody;
  try {
    body = {
      name: requireStr(formData, "name"),
      status: (str(formData, "status") as CreateTestBody["status"]) || undefined,
      coverage: optNum(formData, "coverage"),
      conversionWindowDays: optNum(formData, "conversionWindowDays"),
      urlMatch: optTargeting(formData, "urlMatchJson"),
      variants: parseVariants(formData, "variantsJson"),
      winner: str(formData, "winner") || undefined,
    };
  } catch (e) {
    return parseErrorState(e);
  }

  let createdId: string;
  try {
    const created = await getClient().createTest(body);
    createdId = created.id;
  } catch (e) {
    return toErrorState(e);
  }

  revalidatePath("/");
  redirect(`/tests/${createdId}`);
}

/** B3 — partial edit of a test (only the fields present are sent). */
export async function updateTestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const testId = str(formData, "testId");
  if (!testId) return { error: "Missing test id." };

  let patch: PatchTestBody;
  try {
    patch = {
      name: str(formData, "name") || undefined,
      status: (str(formData, "status") as PatchTestBody["status"]) || undefined,
      coverage: optNum(formData, "coverage"),
      conversionWindowDays: optNum(formData, "conversionWindowDays"),
      urlMatch: optTargeting(formData, "urlMatchJson"),
    };
  } catch (e) {
    return parseErrorState(e);
  }

  try {
    await getClient().patchTest(testId, patch);
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath(`/tests/${testId}`);
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

/** B4 — atomically replace the test's variant set. */
export async function saveVariantsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const testId = str(formData, "testId");
  if (!testId) return { error: "Missing test id." };

  let variants: Variant[];
  try {
    variants = parseVariants(formData, "variantsJson");
  } catch (e) {
    return parseErrorState(e);
  }

  try {
    await getClient().replaceVariants(testId, variants);
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath(`/tests/${testId}`);
  return { ok: true, message: "Variants saved." };
}

/** B5 — roll a winning variant to 100% (status → applied). */
export async function applyWinnerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const testId = str(formData, "testId");
  const winner = str(formData, "winner");
  if (!testId || !winner) return { error: "Pick a winning variant first." };

  try {
    await getClient().applyWinner(testId, winner);
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath(`/tests/${testId}`);
  revalidatePath("/");
  return { ok: true, message: `Applied “${winner}” to 100% of traffic.` };
}

/** B6 — the instant kill switch (status → stopped, edge cache purged). */
export async function stopTestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const testId = str(formData, "testId");
  if (!testId) return { error: "Missing test id." };

  try {
    await getClient().stopTest(testId);
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath(`/tests/${testId}`);
  revalidatePath("/");
  return { ok: true, message: "Test stopped — everyone now sees the original." };
}

export { EMPTY as emptyState };

// ── form parsing ────────────────────────────────────────────────────────────

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function requireStr(fd: FormData, key: string): string {
  const v = str(fd, key);
  if (!v) throw new FormParseError(`${key} is required.`);
  return v;
}

/** Blank → undefined (so the API applies its default); else a parsed number. */
function optNum(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormParseError(`${key} must be a number.`);
  return n;
}

/** Optional URL-targeting JSON. Blank → undefined; non-JSON → a clear parse error. */
function optTargeting(fd: FormData, key: string): UrlTargeting | undefined {
  const v = str(fd, key);
  if (v === "") return undefined;
  try {
    return JSON.parse(v) as UrlTargeting;
  } catch {
    throw new FormParseError(`${key} is not valid JSON.`);
  }
}

/** Required variants JSON (array). Server-side shape rules stay with the API. */
function parseVariants(fd: FormData, key: string): Variant[] {
  const v = str(fd, key);
  if (!v) throw new FormParseError("Add at least one variant.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new FormParseError("Variants payload is not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new FormParseError("Add at least one variant.");
  }
  return parsed as Variant[];
}

class FormParseError extends Error {}

function parseErrorState(e: unknown): FormState {
  if (e instanceof FormParseError) return { error: e.message };
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Map an API failure to form state, surfacing the stable `code` (ARCH §3c). */
function toErrorState(e: unknown): FormState {
  if (e instanceof ApiClientError) {
    return { error: e.message, code: e.code };
  }
  return { error: e instanceof Error ? e.message : String(e) };
}
