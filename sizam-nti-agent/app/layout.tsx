export const metadata = {
  title: "SIZAM NTI Agent",
  description: "Веб-интерфейс к агенту поиска НТИ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          background: "#F8FAFC",
          fontFamily:
            '"Inter Tight", system-ui, -apple-system, Segoe UI, sans-serif',
          color: "#0F172A",
        }}
      >
        {children}
      </body>
    </html>
  );
}
