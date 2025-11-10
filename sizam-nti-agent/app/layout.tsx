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
        <style>{`
          body {
            margin: 0;
            background: #F8FAFC;
            font-family: "Inter Tight", system-ui, -apple-system, Segoe UI, sans-serif;
            color: #0F172A;
          }

          /* ====== таблица результата (markdown) ====== */
          .nti-table {
            width: 100%;
            overflow-x: auto;
          }

          .nti-table table {
            border-collapse: collapse;
            width: 100%;
            font-size: 13px;
            line-height: 1.4;
            background: #fff;
            border-radius: 14px;
            overflow: hidden;
          }

          .nti-table thead tr {
            background: #F8FAFC;
          }

          .nti-table th,
          .nti-table td {
            border: 1px solid #E2E8F0;
            padding: 6px 10px;
            vertical-align: top;
          }

          /* фиксируем шапку, если таблица высокая */
          .nti-table thead th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: #F8FAFC;
            font-weight: 600;
            color: #0F172A;
          }

          /* зебра */
          .nti-table tbody tr:nth-child(even) {
            background: #F8FAFC;
          }

          /* подсветка строки при наведении */
          .nti-table tbody tr:hover {
            background: #E2E8F0;
          }

          /* длинные тексты — аннотации */
          .nti-table td:nth-child(7),
          .nti-table td:nth-child(8) {
            max-width: 280px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          /* ссылка */
          .nti-table td:nth-child(14) {
            max-width: 200px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          /* номер и тип — поменьше */
          .nti-table td:nth-child(1),
          .nti-table td:nth-child(2),
          .nti-table td:nth-child(3),
          .nti-table td:nth-child(4) {
            white-space: nowrap;
          }

          /* на маленьких экранах чуть уменьшаем шрифт в таблице */
          @media (max-width: 768px) {
            .nti-table table {
              font-size: 12px;
            }
            .nti-table td:nth-child(7),
            .nti-table td:nth-child(8) {
              max-width: 180px;
            }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}


