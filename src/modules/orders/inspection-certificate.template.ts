export interface CertificateThemePalette {
  primary: string;
  primaryLight: string;
  accent: string;
  accentHover: string;
  surfaceLight: string;
}

export interface CertificateHtmlContext {
  ownerName: string;
  ownerNationalCode: string;
  itemTitle: string;
  itemCondition: string;
  categoryTitle: string;
  trackingCode: string;
  orderId: string;
  certificateNumber: string;
  verifiedDate: string;
  inspectionResult: string;
}

export interface BuildCertificateHtmlInput {
  title: string;
  body: string;
  footer: string;
  logoDataUri: string | null;
  stampDataUri: string | null;
  fontFaceCss: string;
  context: CertificateHtmlContext;
  palette: CertificateThemePalette;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nl2br(s: string): string {
  return escapeHtml(s)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .join('<br/>');
}

function hexWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildInspectionCertificateHtml(
  input: BuildCertificateHtmlInput,
): string {
  const {
    title,
    body,
    footer,
    logoDataUri,
    stampDataUri,
    fontFaceCss,
    context,
    palette: p,
  } = input;

  const logoBlock = logoDataUri
    ? `<img class="cert-logo" src="${logoDataUri}" alt="طبقه"/>`
    : `<div class="cert-logo-wordmark"><span class="cert-logo-word">طَبَقـه</span><span class="cert-logo-tag">MARKETPLACE</span></div>`;

  const stampBlock = stampDataUri
    ? `<img class="cert-stamp" src="${stampDataUri}" alt="مهر"/>`
    : `<div class="cert-stamp-placeholder" aria-hidden="true"></div>`;

  const surfaceTint = hexWithAlpha(p.primary, 0.05);
  const accentTint = hexWithAlpha(p.accent, 0.1);
  const accentSoft = hexWithAlpha(p.accent, 0.18);
  const borderSoft = hexWithAlpha(p.primary, 0.12);
  const borderDash = hexWithAlpha(p.primary, 0.18);
  const signBorder = hexWithAlpha(p.primary, 0.22);
  const headerGlow = hexWithAlpha(p.accent, 0.35);

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  ${fontFaceCss}
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    font-family: 'Vazir FD-WOL', Tahoma, sans-serif;
    color: ${p.primary};
    background: #f8fafc;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cert-outer {
    width: 210mm;
    height: 297mm;
    padding: 7mm;
    background: linear-gradient(145deg, ${surfaceTint} 0%, #fff 42%, ${hexWithAlpha(p.accent, 0.04)} 100%);
  }
  .cert-frame {
    width: 100%;
    height: 100%;
    border: 2px solid ${borderSoft};
    border-radius: 18px;
    padding: 3mm;
    background: #fff;
    box-shadow:
      0 0 0 1px rgba(255,255,255,.9) inset,
      0 18px 50px -28px ${hexWithAlpha(p.primary, 0.35)};
    position: relative;
    overflow: hidden;
  }
  .cert-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 100% 0%, ${headerGlow} 0%, transparent 42%),
      radial-gradient(circle at 0% 100%, ${hexWithAlpha(p.primary, 0.08)} 0%, transparent 38%);
    pointer-events: none;
  }
  .cert-page {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    padding: 8mm 9mm 7mm;
    display: flex;
    flex-direction: column;
    page-break-after: avoid;
    page-break-inside: avoid;
  }
  .cert-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    background: linear-gradient(120deg, ${p.primary} 0%, ${p.primaryLight} 55%, ${p.accent} 160%);
    color: #fff;
    border-radius: 14px;
    padding: 14px 18px;
    flex-shrink: 0;
    box-shadow: 0 12px 28px -14px ${hexWithAlpha(p.primary, 0.55)};
  }
  .cert-logo-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .cert-logo {
    max-height: 52px;
    max-width: 150px;
    object-fit: contain;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,.15));
  }
  .cert-logo-wordmark {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cert-logo-word {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .cert-logo-tag {
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.22em;
    opacity: 0.85;
  }
  .cert-top-meta {
    text-align: left;
    font-size: 9px;
    line-height: 1.75;
    min-width: 44%;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.22);
    border-radius: 10px;
    padding: 8px 10px;
    backdrop-filter: blur(4px);
  }
  .cert-top-meta strong { font-weight: 700; }
  .cert-badge-row {
    display: flex;
    justify-content: center;
    margin-top: 10px;
    flex-shrink: 0;
  }
  .cert-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 8.5px;
    font-weight: 700;
    color: ${p.primary};
    background: ${accentTint};
    border: 1px solid ${accentSoft};
  }
  .cert-badge-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${p.accent};
    box-shadow: 0 0 0 3px ${hexWithAlpha(p.accent, 0.25)};
  }
  .cert-title-wrap {
    text-align: center;
    padding: 12px 0 10px;
    flex-shrink: 0;
  }
  .cert-title {
    font-size: 22px;
    font-weight: 700;
    color: ${p.primary};
    line-height: 1.35;
    letter-spacing: -0.01em;
  }
  .cert-title-bar {
    width: 72px;
    height: 4px;
    background: linear-gradient(90deg, ${p.accent}, ${p.accentHover});
    border-radius: 4px;
    margin: 8px auto 0;
  }
  .cert-body-wrap {
    flex: 0 1 auto;
    max-height: 54mm;
    overflow: hidden;
    margin: 0 2px;
    padding: 12px 14px;
    border-radius: 12px;
    background: linear-gradient(180deg, ${surfaceTint}, #fff);
    border: 1px solid ${borderSoft};
  }
  .cert-body {
    font-size: 10.5px;
    line-height: 1.85;
    color: #334155;
    text-align: justify;
  }
  .cert-info {
    margin-top: 10px;
    background: #fff;
    border: 1px solid ${borderSoft};
    border-radius: 12px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px 12px;
    flex-shrink: 0;
    box-shadow: 0 8px 24px -18px ${hexWithAlpha(p.primary, 0.4)};
  }
  .cert-info .cell {
    min-width: 0;
    padding: 6px 8px;
    border-radius: 8px;
    background: ${surfaceTint};
    border-right: 3px solid ${p.accent};
  }
  .cert-info .label {
    display: block;
    color: ${p.primaryLight};
    font-size: 8px;
    font-weight: 500;
    margin-bottom: 2px;
  }
  .cert-info .val {
    display: block;
    color: ${p.primary};
    font-weight: 700;
    font-size: 9.5px;
    word-break: break-word;
    line-height: 1.45;
  }
  .cert-result {
    margin-top: 9px;
    padding: 10px 12px;
    background: linear-gradient(135deg, ${accentTint}, #fff);
    border: 1px solid ${accentSoft};
    border-radius: 10px;
    font-size: 9.5px;
    line-height: 1.7;
    color: ${p.primary};
    flex-shrink: 0;
  }
  .cert-result strong {
    display: block;
    color: ${p.accentHover};
    font-weight: 700;
    font-size: 10px;
    margin-bottom: 4px;
  }
  .cert-bottom {
    margin-top: auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-top: 10px;
    flex-shrink: 0;
  }
  .cert-stamp-wrap {
    text-align: center;
    min-width: 130px;
    padding: 8px;
    border-radius: 10px;
    background: ${surfaceTint};
    border: 1px dashed ${borderDash};
  }
  .cert-stamp { max-height: 80px; max-width: 110px; object-fit: contain; }
  .cert-stamp-placeholder {
    width: 72px;
    height: 72px;
    margin: 0 auto;
    border-radius: 50%;
    border: 2px dashed ${borderDash};
    background: radial-gradient(circle, ${accentTint}, transparent 70%);
  }
  .cert-stamp-label {
    font-size: 8px;
    color: #64748b;
    margin-top: 5px;
    line-height: 1.45;
    font-weight: 500;
  }
  .cert-sign {
    text-align: center;
    min-width: 120px;
    padding: 32px 12px 0;
    border-top: 2px solid ${signBorder};
    font-size: 8.5px;
    color: #64748b;
    font-weight: 500;
  }
  .cert-sign::before {
    content: '';
    display: block;
    width: 80%;
    height: 28px;
    margin: 0 auto 6px;
    border-bottom: 1px solid ${hexWithAlpha(p.primary, 0.15)};
    opacity: 0.7;
  }
  .cert-footer {
    margin-top: 8px;
    padding: 9px 12px;
    border-radius: 10px;
    background: ${surfaceTint};
    border: 1px dashed ${borderDash};
    font-size: 8.5px;
    line-height: 1.6;
    color: #64748b;
    text-align: center;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="cert-outer">
    <div class="cert-frame">
      <div class="cert-page">
        <header class="cert-top">
          <div class="cert-logo-wrap">
            ${logoBlock}
          </div>
          <div class="cert-top-meta">
            <div><strong>شماره گواهی:</strong> ${escapeHtml(context.certificateNumber)}</div>
            <div><strong>تاریخ صدور:</strong> ${escapeHtml(context.verifiedDate)}</div>
            <div><strong>شماره سفارش:</strong> ${escapeHtml(context.orderId.slice(-12))}</div>
          </div>
        </header>

        <div class="cert-badge-row">
          <span class="cert-badge"><span class="cert-badge-dot"></span>سند رسمی کارشناسی فنی</span>
        </div>

        <div class="cert-title-wrap">
          <h1 class="cert-title">${escapeHtml(title)}</h1>
          <div class="cert-title-bar"></div>
        </div>

        <div class="cert-body-wrap">
          <div class="cert-body">${nl2br(body)}</div>
        </div>

        <section class="cert-info">
          <div class="cell"><span class="label">صاحب کالا</span><span class="val">${escapeHtml(context.ownerName)}</span></div>
          <div class="cell"><span class="label">کد ملی</span><span class="val">${escapeHtml(context.ownerNationalCode)}</span></div>
          <div class="cell"><span class="label">عنوان کالا</span><span class="val">${escapeHtml(context.itemTitle)}</span></div>
          <div class="cell"><span class="label">دسته‌بندی</span><span class="val">${escapeHtml(context.categoryTitle)}</span></div>
          <div class="cell"><span class="label">وضعیت</span><span class="val">${escapeHtml(context.itemCondition)}</span></div>
          <div class="cell"><span class="label">کد رهگیری</span><span class="val">${escapeHtml(context.trackingCode)}</span></div>
        </section>

        <div class="cert-result"><strong>نتیجه کارشناسی</strong>${escapeHtml(context.inspectionResult)}</div>

        <div class="cert-bottom">
          <div class="cert-stamp-wrap">
            ${stampBlock}
            <div class="cert-stamp-label">مهر مرکز پردازش طبقه</div>
          </div>
          <div class="cert-sign">امضای کارشناس مسئول</div>
        </div>

        <footer class="cert-footer">${nl2br(footer)}</footer>
      </div>
    </div>
  </div>
</body>
</html>`;
}
