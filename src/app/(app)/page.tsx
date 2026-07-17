// Placeholder home page. The onboarding concierge flow lands here in a later
// task; for now it just confirms the app is online after the auth/membership gate.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1
        className="text-2xl font-bold text-[#ede6e6]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Mate — onboarding coming online
      </h1>
    </div>
  );
}
