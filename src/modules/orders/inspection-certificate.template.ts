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
    : `<div class="cert-logo-text">طَبَقـه</div>`;

  const stampBlock = stampDataUri
    ? `<img class="cert-stamp" src="${stampDataUri}" alt="مهر"/>`
    : '';

  const surfaceTint = hexWithAlpha(p.primary, 0.06);
  const accentTint = hexWithAlpha(p.accent, 0.12);
  const borderSoft = hexWithAlpha(p.primary, 0.14);
  const borderDash = hexWithAlpha(p.primary, 0.2);
  const signBorder = hexWithAlpha(p.primary, 0.25);

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
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cert-page {
    width: 210mm;
    height: 297mm;
    padding: 10mm 11mm 9mm;
    display: flex;
    flex-direction: column;
    page-break-after: avoid;
    page-break-inside: avoid;
  }
  .cert-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: linear-gradient(135deg, ${p.primary} 0%, ${p.primaryLight} 100%);
    color: #fff;
    border-radius: 12px;
    padding: 10px 14px;
    flex-shrink: 0;
  }
  .cert-logo { max-height: 44px; max-width: 130px; object-fit: contain; }
  .cert-logo-text {
    font-size: 22px;
    font-weight: 700;
    border: 2px solid rgba(255,255,255,.35);
    padding: 4px 12px;
    border-radius: 8px;
  }
  .cert-top-meta { text-align: left; font-size: 9px; line-height: 1.65; min-width: 42%; }
  .cert-top-meta strong { font-weight: 700; }
  .cert-title-wrap { text-align: center; padding: 9px 0 7px; flex-shrink: 0; }
  .cert-title { font-size: 19px; font-weight: 700; color: ${p.primary}; line-height: 1.35; }
  .cert-title-bar { width: 56px; height: 3px; background: ${p.accent}; border-radius: 2px; margin: 6px auto 0; }
  .cert-body {
    font-size: 10.5px;
    line-height: 1.72;
    color: #334155;
    text-align: justify;
    padding: 0 2px;
    flex: 0 1 auto;
    max-height: 52mm;
    overflow: hidden;
  }
  .cert-info {
    margin-top: 8px;
    background: ${surfaceTint};
    border: 1px solid ${borderSoft};
    border-right: 3px solid ${p.accent};
    border-radius: 10px;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 5px 10px;
    flex-shrink: 0;
  }
  .cert-info .cell { min-width: 0; }
  .cert-info .label {
    display: block;
    color: ${p.primaryLight};
    font-size: 8.5px;
    font-weight: 500;
    margin-bottom: 1px;
  }
  .cert-info .val {
    display: block;
    color: ${p.primary};
    font-weight: 700;
    font-size: 9.5px;
    word-break: break-word;
  }
  .cert-result {
    margin-top: 7px;
    padding: 6px 9px;
    background: ${accentTint};
    border-radius: 8px;
    font-size: 9.5px;
    line-height: 1.6;
    color: ${p.primary};
    flex-shrink: 0;
  }
  .cert-result strong { color: ${p.accentHover}; font-weight: 700; }
  .cert-bottom {
    margin-top: auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding-top: 8px;
    flex-shrink: 0;
  }
  .cert-stamp-wrap { text-align: center; min-width: 120px; }
  .cert-stamp { max-height: 72px; max-width: 100px; object-fit: contain; }
  .cert-stamp-label { font-size: 8px; color: #64748b; margin-top: 3px; line-height: 1.4; }
  .cert-sign {
    text-align: center;
    min-width: 110px;
    padding-top: 28px;
    border-top: 1px solid ${signBorder};
    font-size: 8.5px;
    color: #64748b;
  }
  .cert-footer {
    margin-top: 7px;
    padding-top: 7px;
    border-top: 1px dashed ${borderDash};
    font-size: 8.5px;
    line-height: 1.55;
    color: #64748b;
    text-align: center;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="cert-page">
    <header class="cert-top">
      ${logoBlock}
      <div class="cert-top-meta">
        <div><strong>شماره گواهی:</strong> ${escapeHtml(context.certificateNumber)}</div>
        <div><strong>تاریخ صدور:</strong> ${escapeHtml(context.verifiedDate)}</div>
        <div><strong>شماره سفارش:</strong> ${escapeHtml(context.orderId.slice(-12))}</div>
      </div>
    </header>

    <div class="cert-title-wrap">
      <h1 class="cert-title">${escapeHtml(title)}</h1>
      <div class="cert-title-bar"></div>
    </div>

    <div class="cert-body">${nl2br(body)}</div>

    <section class="cert-info">
      <div class="cell"><span class="label">صاحب کالا</span><span class="val">${escapeHtml(context.ownerName)}</span></div>
      <div class="cell"><span class="label">کد ملی</span><span class="val">${escapeHtml(context.ownerNationalCode)}</span></div>
      <div class="cell"><span class="label">عنوان کالا</span><span class="val">${escapeHtml(context.itemTitle)}</span></div>
      <div class="cell"><span class="label">دسته‌بندی</span><span class="val">${escapeHtml(context.categoryTitle)}</span></div>
      <div class="cell"><span class="label">وضعیت</span><span class="val">${escapeHtml(context.itemCondition)}</span></div>
      <div class="cell"><span class="label">کد رهگیری</span><span class="val">${escapeHtml(context.trackingCode)}</span></div>
    </section>

    <div class="cert-result"><strong>نتیجه کارشناسی:</strong> ${escapeHtml(context.inspectionResult)}</div>

    <div class="cert-bottom">
      <div class="cert-stamp-wrap">
        ${stampBlock}
        <div class="cert-stamp-label">مهر مرکز پردازش طبقه</div>
      </div>
      <div class="cert-sign">امضای کارشناس مسئول</div>
    </div>

    <footer class="cert-footer">${nl2br(footer)}</footer>
  </div>
</body>
</html>`;
}
