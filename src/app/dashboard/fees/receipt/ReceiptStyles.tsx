// Shared print/screen styles for the fee-payment receipt pages — extracted
// verbatim from the single-payment receipt so the new combined (registration)
// receipt can reuse the exact same look without duplicating ~250 lines of CSS.
export function ReceiptStyles() {
  return (
    <style>{`
        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: #F8F8F6;
          font-family: Arial, Helvetica, sans-serif;
          color: #1A1A16;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .screen-wrap {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 32px 16px 64px;
        }

        .actions-bar {
          width: 100%;
          max-width: 420px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .back-link {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          color: #4A4A44;
          text-decoration: none;
        }
        .back-link:hover { color: #F06418; }

        /* ── Receipt card ── */
        .receipt {
          width: 100%;
          max-width: 420px;
          background: #fff;
          border: 1px solid #E4E4DE;
          border-radius: 16px;
          overflow: hidden;
        }

        /* Header */
        .receipt-header {
          background: #111111 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          padding: 24px 24px 20px;
          text-align: center;
        }
        .receipt-header img {
          height: 52px;
          width: auto;
          object-fit: contain;
          margin: 0 auto 8px;
          display: block;
        }
        .gym-name {
          color: #F06418 !important;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin: 0 0 4px;
        }
        .gym-sub {
          color: rgba(255,255,255,0.6) !important;
          font-size: 11px;
          margin: 0;
          line-height: 1.6;
        }

        /* Receipt no + date row */
        .receipt-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 24px;
          border-bottom: 2px dashed #E4E4DE;
          background: #FAFAF8;
        }
        .receipt-no-label {
          font-size: 10px;
          font-weight: 700;
          color: #7A7A72;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 2px;
        }
        .receipt-no-value {
          font-size: 18px;
          font-weight: 800;
          color: #F06418 !important;
          font-family: monospace;
          margin: 0;
        }
        .date-label {
          font-size: 10px;
          font-weight: 700;
          color: #7A7A72;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 2px;
          text-align: right;
        }
        .date-value {
          font-size: 13px;
          font-weight: 600;
          color: #1A1A16;
          margin: 0;
          text-align: right;
        }

        /* Sections */
        .section {
          padding: 14px 24px;
          border-bottom: 1px dashed #E4E4DE;
        }
        .section:last-child { border-bottom: none; }

        .section-title {
          font-size: 9px;
          font-weight: 700;
          color: #7A7A72;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 0 0 10px;
        }

        .row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 6px;
          font-size: 13px;
          gap: 12px;
        }
        .row:last-child { margin-bottom: 0; }

        .row-label {
          color: #7A7A72;
          flex-shrink: 0;
          min-width: 110px;
        }
        .row-value {
          color: #1A1A16;
          font-weight: 600;
          text-align: right;
        }
        .row-value.mono {
          font-family: monospace;
          color: #F06418 !important;
        }
        .row-value.discount {
          color: #F06418 !important;
        }

        /* Total row */
        .total-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 2px solid #1A1A16;
        }
        .total-label {
          font-size: 14px;
          font-weight: 800;
          color: #1A1A16;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .total-amount {
          font-size: 24px;
          font-weight: 800;
          color: #1A1A16;
        }

        /* Footer */
        .receipt-footer {
          background: #F06418 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          padding: 14px 24px;
          text-align: center;
        }
        .footer-text {
          color: #fff !important;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 2px;
        }
        .footer-id {
          color: rgba(255,255,255,0.7) !important;
          font-size: 9px;
          font-family: monospace;
          margin: 0;
        }

        /* Print-only second button */
        .print-link-wrap {
          margin-top: 16px;
          text-align: center;
        }

        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; padding: 0; }
          .screen-wrap { padding: 0; background: #fff; }
          .receipt {
            max-width: 100%;
            border: none;
            border-radius: 0;
          }
          .receipt-header { background: #111111 !important; }
          .gym-name { color: #F06418 !important; }
          .gym-sub { color: rgba(255,255,255,0.7) !important; }
          .receipt-no-value { color: #F06418 !important; }
          .row-value.mono { color: #F06418 !important; }
          .row-value.discount { color: #F06418 !important; }
          .receipt-footer { background: #F06418 !important; }
          .footer-text { color: #fff !important; }
          .footer-id { color: rgba(255,255,255,0.7) !important; }
        }

        @page {
          size: A5;
          margin: 1cm;
        }
      `}</style>
  );
}
