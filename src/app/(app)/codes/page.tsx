import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateAccessCode, codeState } from "@/lib/portal/access-code";

export const dynamic = "force-dynamic";

async function requireInternalEmail(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const service = createServiceClient();
  const { data: access } = await service
    .from("portal_access")
    .select("client_slug")
    .eq("email", user.email)
    .eq("client_slug", "mate")
    .maybeSingle();
  if (!access) redirect("/login?error=unauthorized");
  return user.email;
}

async function createCodeAction(formData: FormData) {
  "use server";
  const email = await requireInternalEmail();
  const label = String(formData.get("company_label") ?? "").trim();
  if (!label) return;
  const service = createServiceClient();
  await service.from("portal_codes").insert({
    code: generateAccessCode(),
    company_label: label,
    created_by: email,
  });
  revalidatePath("/codes");
}

async function revokeCodeAction(formData: FormData) {
  "use server";
  await requireInternalEmail();
  const code = String(formData.get("code") ?? "");
  if (!code) return;
  const service = createServiceClient();
  // Only unclaimed codes can be revoked; expiring now kills the invite.
  await service
    .from("portal_codes")
    .update({ expires_at: new Date().toISOString() })
    .eq("code", code)
    .is("claimed_at", null);
  revalidatePath("/codes");
}

export default async function CodesPage() {
  await requireInternalEmail();
  const service = createServiceClient();
  const { data: codes } = await service
    .from("portal_codes")
    .select("code, company_label, claimed_by_email, claimed_at, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const now = new Date();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-[#ede6e6]" style={{ fontFamily: "var(--font-display)" }}>
        Access codes
      </h1>

      <form action={createCodeAction} className="flex gap-2">
        <input
          type="text"
          name="company_label"
          required
          placeholder="company / client name"
          className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
        />
        <button
          type="submit"
          className="bg-[#e14d1a] hover:bg-[#f15d2a] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          mint code
        </button>
      </form>

      <div className="space-y-2">
        {(codes ?? []).map((c) => {
          const state = codeState(c, now);
          return (
            <div
              key={c.code}
              className="flex items-center justify-between gap-3 border border-[#333] rounded-lg px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm text-[#ede6e6] tracking-wider select-all">{c.code}</div>
                <div className="text-xs text-[#888] truncate">{c.company_label}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                {state === "valid" && (
                  <>
                    <span className="text-[#4caf7d]">valid</span>
                    <form action={revokeCodeAction}>
                      <input type="hidden" name="code" value={c.code} />
                      <button type="submit" className="text-[#888] hover:text-[#e74c3c] transition-colors">
                        revoke
                      </button>
                    </form>
                  </>
                )}
                {state === "claimed" && (
                  <span className="text-[#888]">claimed by {c.claimed_by_email ?? "?"}</span>
                )}
                {state === "expired" && <span className="text-[#e74c3c]">expired</span>}
              </div>
            </div>
          );
        })}
        {(codes ?? []).length === 0 && <div className="text-sm text-[#666]">no codes yet</div>}
      </div>
    </div>
  );
}
