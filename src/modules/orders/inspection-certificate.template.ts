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
  orderId: string;
  orderIdShort: string;
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

/**
 * پس از escape، عبارات مهم (نام، تاریخ، شماره‌ها، …) با <strong> برجسته می‌شوند.
 * جایگزینی از بلند به کوتاه تا زیررشته‌ای مثل شناسهٔ کوتاه سفارش داخل شناسهٔ کامل تکرار نشود.
 */
function wrapImportantPhrasesAfterEscape(
  escapedPlain: string,
  context: CertificateHtmlContext,
): string {
  const rawPhrases = [
    context.certificateNumber,
    context.orderId,
    context.orderIdShort,
    context.ownerName,
    context.ownerNationalCode,
    context.itemTitle,
    context.categoryTitle,
    context.itemCondition,
    context.verifiedDate,
    'مرکز پردازش طبقه',
    'سامانه طبقه',
  ];
  const phrases = [...new Set(rawPhrases.map((s) => String(s ?? '').trim()))].filter(
    (s) => s.length >= 2 && s !== '—',
  );

  const escapedPhrases = phrases
    .map((p) => ({ raw: p, esc: escapeHtml(p) }))
    .filter((x) => x.esc.length >= 2)
    .sort((a, b) => b.esc.length - a.esc.length);

  let work = escapedPlain;
  const holders: string[] = [];

  escapedPhrases.forEach(({ esc }, idx) => {
    if (!work.includes(esc)) return;
    const marker = `{{{__CERT_BOLD_${idx}__}}}`;
    holders[idx] = `<strong>${esc}</strong>`;
    work = work.split(esc).join(marker);
  });

  let out = work;
  holders.forEach((html, idx) => {
    if (!html) return;
    out = out.split(`{{{__CERT_BOLD_${idx}__}}}`).join(html);
  });
  return out;
}

function certificateRichTextToHtml(
  plain: string,
  context: CertificateHtmlContext,
): string {
  const escaped = escapeHtml(plain);
  const wrapped = wrapImportantPhrasesAfterEscape(escaped, context);
  return wrapped
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

  const bodyHtml = certificateRichTextToHtml(body, context);
  const resultHtml = certificateRichTextToHtml(context.inspectionResult, context);
  const footerHtml = escapeHtml(footer)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .join('<br/>');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  ${fontFaceCss}
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    direction: rtl;
    text-align: right;
    font-family: ${fontStack};
    font-size: 10pt;
    line-height: 1.55;
    letter-spacing: 0;
    word-spacing: normal;
    color: ${p.primary};
    background: #fff;
  }
  .cert-page {
    width: 100%;
    max-width: 186mm;
    min-height: 268mm;
    margin: 0 auto;
    padding-inline: 3mm;
    padding-bottom: 22mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 16px;
    page-break-inside: avoid;
    page-break-after: avoid;
  }
  .cert-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding: 4px 4px 12px;
    border-bottom: 2px solid ${p.accent};
  }
  .cert-logo-wrap {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    flex: 0 0 auto;
    min-width: 0;
    padding: 4px 0 4px 8px;
    box-sizing: border-box;
  }
  .cert-logo {
    display: block;
    height: 18mm;
    width: auto;
    max-width: 48mm;
    object-fit: contain;
    object-position: right center;
  }
  .cert-logo-wordmark {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
    max-width: 100%;
  }
  .cert-logo-word {
    font-size: 22pt;
    font-weight: 700;
    color: ${p.accent};
    line-height: 1.12;
    padding: 0 2px;
    box-sizing: border-box;
  }
  .cert-logo-tag {
    font-size: 8pt;
    font-weight: 700;
    color: ${p.primaryLight};
    letter-spacing: 0.12em;
  }
  .cert-top-meta {
    text-align: right;
    text-align-last: right;
    unicode-bidi: plaintext;
    font-size: 9pt;
    line-height: 1.75;
    min-width: 38%;
    max-width: 44%;
    flex: 0 1 auto;
    color: ${p.primaryLight};
    border: 1px solid ${p.accent};
    border-radius: 8px;
    padding: 10px 12px;
  }
  .cert-top-meta strong {
    color: ${p.accent};
    font-weight: 700;
  }
  .cert-badge-row {
    display: flex;
    justify-content: center;
    padding-top: 4px;
  }
  .cert-badge {
    display: inline-block;
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 8.5pt;
    font-weight: 700;
    color: ${p.accent};
    border: 1px solid ${p.accent};
  }
  .cert-title-wrap {
    text-align: center;
    padding: 6px 0 4px;
  }
  .cert-title {
    font-size: 17pt;
    font-weight: 700;
    color: ${p.accent};
    line-height: 1.35;
  }
  .cert-title-bar {
    width: 64px;
    height: 3px;
    background: ${p.accent};
    border-radius: 2px;
    margin: 8px auto 0;
  }
  .cert-body-wrap {
    padding: 12px 14px;
    border: 1px solid ${p.primaryLight};
    border-radius: 8px;
    border-right: 3px solid ${p.accent};
  }
  .cert-body {
    font-size: 10pt;
    line-height: 1.75;
    color: #334155;
    text-align: right;
    text-align-last: right;
    unicode-bidi: plaintext;
    word-break: break-word;
  }
  .cert-body strong,
  .cert-result .result-text strong {
    color: ${p.primary};
    font-weight: 700;
  }
  .cert-info {
    border: 1px solid ${p.primaryLight};
    border-radius: 8px;
    padding: 12px 14px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 10px;
  }
  .cert-info .cell {
    min-width: 0;
    padding: 6px 4px;
  }
  .cert-info .cell:nth-child(odd):not(.cell-span-2) {
    border-inline-end: 2px solid ${p.accent};
    padding-inline-end: 14px;
  }
  .cert-info .cell:nth-child(even) {
    padding-inline-start: 6px;
  }
  .cert-info .cell-span-2 {
    grid-column: 1 / -1;
    border-inline-end: none;
    border-top: 1px dashed ${p.primaryLight};
    padding-top: 14px;
    margin-top: 4px;
    padding-inline-start: 0;
  }
  .cert-info .label {
    display: block;
    color: ${p.accent};
    font-size: 8.5pt;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .cert-info .val {
    display: block;
    color: ${p.primary};
    font-weight: 700;
    font-size: 10pt;
    word-break: break-word;
    line-height: 1.5;
  }
  .cert-result {
    padding: 12px 14px;
    border: 1px solid ${p.accent};
    border-radius: 8px;
    font-size: 10pt;
    line-height: 1.65;
    color: ${p.primary};
    text-align: right;
    unicode-bidi: plaintext;
  }
  .cert-result strong.title {
    display: block;
    color: ${p.accent};
    font-weight: 700;
    font-size: 10.5pt;
    margin-bottom: 8px;
  }
  .cert-result .result-text {
    font-size: 10pt;
    line-height: 1.7;
  }
  .cert-signature-zone {
    margin-top: auto;
    padding-top: 10mm;
    min-height: 34mm;
  }
  .cert-bottom {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-top: 4mm;
  }
  .cert-stamp-wrap {
    text-align: center;
    min-width: 120px;
  }
  .cert-stamp {
    max-height: 64px;
    max-width: 92px;
    object-fit: contain;
  }
  .cert-stamp-label {
    font-size: 8pt;
    color: ${p.primaryLight};
    margin-top: 6px;
    font-weight: 500;
  }
  .cert-sign {
    text-align: center;
    min-width: 120px;
    padding: 26px 12px 0;
    border-top: 1px solid ${p.primaryLight};
    font-size: 8.5pt;
    color: ${p.primaryLight};
    font-weight: 500;
  }
  .cert-footer {
    padding: 10px 8px 0;
    border-top: 1px dashed ${p.primaryLight};
    font-size: 8.5pt;
    line-height: 1.55;
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
        <div><strong>شماره سفارش:</strong> ${escapeHtml(context.orderIdShort)}</div>
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
      <div class="cert-body">${bodyHtml}</div>
    </div>

    <section class="cert-info" aria-label="خلاصه مشخصات کالا">
      <div class="cell"><span class="label">صاحب کالا</span><span class="val">${escapeHtml(context.ownerName)}</span></div>
      <div class="cell"><span class="label">کد ملی</span><span class="val">${escapeHtml(context.ownerNationalCode)}</span></div>
      <div class="cell"><span class="label">عنوان کالا</span><span class="val">${escapeHtml(context.itemTitle)}</span></div>
      <div class="cell"><span class="label">دسته‌بندی</span><span class="val">${escapeHtml(context.categoryTitle)}</span></div>
      <div class="cell cell-span-2"><span class="label">وضعیت کالا</span><span class="val">${escapeHtml(context.itemCondition)}</span></div>
    </section>

    <div class="cert-result"><strong class="title">نتیجه کارشناسی</strong><div class="result-text">${resultHtml}</div></div>

    <div class="cert-signature-zone">
      <div class="cert-bottom">
        <div class="cert-stamp-wrap">
          ${stampBlock}
          <div class="cert-stamp-label">مهر مرکز پردازش طبقه</div>
        </div>
        <div class="cert-sign">امضای کارشناس مسئول</div>
      </div>
    </div>

    <footer class="cert-footer">${footerHtml}</footer>
  </div>
</body>
</html>`;
}
