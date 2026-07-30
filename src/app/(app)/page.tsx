// Internal-staff home (portal_access client_slug='mate'). Reached via /postlogin
// for internal users. A small hub to the internal tools; end-clients never see it.
import Link from "next/link";
import { Ticket, Eye } from "@phosphor-icons/react/dist/ssr";
import { DEMO_SESSION_ID } from "@/lib/portal/demo";

export const dynamic = "force-dynamic";

const CARD =
  "flex items-start gap-3 border border-[#333] rounded-xl px-4 py-4 hover:border-[#e14d1a] transition-colors";

export default function HomePage() {
  return (
    <div className="max-w-lg mx-auto space-y-5 py-6">
      <div>
        <h1
          className="text-xl font-bold text-[#ede6e6]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mate
        </h1>
        <p className="text-sm text-[#888] mt-1">internal</p>
      </div>

      <div className="space-y-3">
        <Link href="/codes" className={CARD}>
          <Ticket size={22} className="text-[#e14d1a] shrink-0 mt-0.5" />
          <span>
            <span className="block text-sm font-semibold text-[#ede6e6]">Access codes</span>
            <span className="block text-xs text-[#888] mt-0.5">
              Mint and track client invite codes.
            </span>
          </span>
        </Link>

        <Link href={`/dash/${DEMO_SESSION_ID}`} className={CARD}>
          <Eye size={22} className="text-[#e14d1a] shrink-0 mt-0.5" />
          <span>
            <span className="block text-sm font-semibold text-[#ede6e6]">View demo dashboard</span>
            <span className="block text-xs text-[#888] mt-0.5">
              The sample dashboard waitlisted users see.
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
