import Link from 'next/link';

export default function GlobalNotFound() {
  return (
    <html lang="zh">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          background: '#0a0a0a',
          color: '#e5e5e5',
        }}
      >
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <h1
            style={{
              fontSize: '48px',
              fontWeight: 500,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            404
          </h1>
          <p style={{ marginTop: '8px', color: '#a0a0a0' }}>Page not found</p>
          <Link
            href="/zh"
            style={{
              display: 'inline-block',
              marginTop: '24px',
              padding: '8px 16px',
              border: '1px solid #2a2a2a',
              borderRadius: '6px',
              color: '#e5e5e5',
              textDecoration: 'none',
            }}
          >
            返回首页
          </Link>
        </div>
      </body>
    </html>
  );
}
