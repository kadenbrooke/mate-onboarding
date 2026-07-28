export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#ede6e6' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 90px' }}>{children}</div>
    </div>
  );
}
