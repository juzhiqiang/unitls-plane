import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Utils Plane',
  description: 'A monorepo for utilities',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}