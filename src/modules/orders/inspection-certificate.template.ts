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
  fontFamily: string;
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
    fontFamily,
    context,
    palette: p,
  } = input;

  const fontStack = `'${fontFamily}', Tahoma, 'Segoe UI', Arial, sans-serif`;

  const logoBlock = logoDataUri
    ? `<img class="cert-logo" src="${logoDataUri}" alt="طبقه"/>`
    : `<div class="cert-logo-wordmark"><span class="cert-logo-word">${escapeHtml('طَبَقـه')}</span><span class="cert-logo-tag">MARKETPLACE</span></div>`;

  const stampBlock = stampDataUri
    ? `<img class="cert-stamp" src="${stampDataUri}" alt="مهر"/>`
    : '';

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  ${fontFaceCss}
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    direction: rtl;
    text-align: right;
    font-family: ${fontStack};
    font-size: 10.5pt;
    line-height: 1.65;
    letter-spacing: 0;
    word-spacing: normal;
    color: ${p.primary};
    background: #fff;
  }
  .cert-page {
    width: 100%;
    max-width: 186mm;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    page-break-inside: avoid;
  }
  .cert-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 10px;
    border-bottom: 2px solid ${p.accent};
  }
  .cert-logo-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .cert-logo {
    max-height: 48px;
    max-width: 140px;
    object-fit: contain;
  }
  .cert-logo-wordmark {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cert-logo-word {
    font-size: 20pt;
    font-weight: 700;
    color: ${p.accent};
    line-height: 1.1;
  }
  .cert-logo-tag {
    font-size: 7pt;
    font-weight: 700;
    color: ${p.primaryLight};
    letter-spacing: 0.12em;
  }
  .cert-top-meta {
    text-align: left;
    font-size: 8.5pt;
    line-height: 1.7;
    min-width: 42%;
    color: ${p.primaryLight};
    border: 1px solid ${p.accent};
    border-radius: 8px;
    padding: 8px 10px;
  }
  .cert-top-meta strong {
    color: ${p.accent};
    font-weight: 700;
  }
  .cert-badge-row {
    display: flex;
    justify-content: center;
  }
  .cert-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 8.5pt;
    font-weight: 700;
    color: ${p.accent};
    border: 1px solid ${p.accent};
  }
  .cert-title-wrap {
    text-align: center;
    padding: 4px 0 2px;
  }
  .cert-title {
    font-size: 18pt;
    font-weight: 700;
    color: ${p.accent};
    line-height: 1.35;
  }
  .cert-title-bar {
    width: 64px;
    height: 3px;
    background: ${p.accent};
    border-radius: 2px;
    margin: 6px auto 0;
  }
  .cert-body-wrap {
    padding: 10px 12px;
    border: 1px solid ${p.primaryLight};
    border-radius: 8px;
    border-right: 3px solid ${p.accent};
  }
  .cert-body {
    font-size: 10pt;
    line-height: 1.8;
    color: #334155;
    text-align: right;
    text-align-last: right;
    unicode-bidi: plaintext;
    word-break: break-word;
  }
  .cert-info {
    border: 1px solid ${p.primaryLight};
    border-radius: 8px;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px 10px;
  }
  .cert-info .cell {
    min-width: 0;
    padding: 4px 6px 4px 0;
    border-right: 2px solid ${p.accent};
  }
  .cert-info .label {
    display: block;
    color: ${p.accent};
    font-size: 8pt;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .cert-info .val {
    display: block;
    color: ${p.primary};
    font-weight: 700;
    font-size: 9pt;
    word-break: break-word;
    line-height: 1.45;
  }
  .cert-result {
    padding: 10px 12px;
    border: 1px solid ${p.accent};
    border-radius: 8px;
    font-size: 9.5pt;
    line-height: 1.7;
    color: ${p.primary};
    text-align: right;
    unicode-bidi: plaintext;
  }
  .cert-result strong {
    display: block;
    color: ${p.accent};
    font-weight: 700;
    font-size: 10pt;
    margin-bottom: 4px;
  }
  .cert-bottom {
    margin-top: 4px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-top: 8px;
  }
  .cert-stamp-wrap {
    text-align: center;
    min-width: 120px;
  }
  .cert-stamp {
    max-height: 72px;
    max-width: 100px;
    object-fit: contain;
  }
  .cert-stamp-label {
    font-size: 8pt;
    color: ${p.primaryLight};
    margin-top: 4px;
    font-weight: 500;
  }
  .cert-sign {
    text-align: center;
    min-width: 110px;
    padding: 28px 10px 0;
    border-top: 1px solid ${p.primaryLight};
    font-size: 8.5pt;
    color: ${p.primaryLight};
    font-weight: 500;
  }
  .cert-footer {
    padding: 8px 10px;
    border-top: 1px dashed ${p.primaryLight};
    font-size: 8.5pt;
    line-height: 1.6;
    color: ${p.primaryLight};
    text-align: center;
  }
</style>
</head>
<body>
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
      <span class="cert-badge">سند رسمی کارشناسی فنی</span>
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
</body>
</html>`;
}
