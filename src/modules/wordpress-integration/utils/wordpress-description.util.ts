import { sanitizeRichHtml } from '../../../common/sanitize/html-sanitizer.util';
import { WordPressProductAttributeDto, WordPressProductDto } from '../dto/wordpress-product.dto';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeHtmlBlock(value: string | undefined | null): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed;
  }
  return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
}

function buildAttributesHtml(attributes: WordPressProductAttributeDto[]): string {
  const visible = attributes.filter(
    (attr) => attr.visible && !attr.variation && attr.options.length > 0,
  );
  if (visible.length === 0) {
    return '';
  }

  const rows = visible
    .map((attr) => {
      const options = attr.options.map((option) => escapeHtml(option)).join('، ');
      return `<tr><th>${escapeHtml(attr.name)}</th><td>${options}</td></tr>`;
    })
    .join('');

  return `<h3>مشخصات</h3><table class="tabagheh-wp-attrs"><tbody>${rows}</tbody></table>`;
}

/** ترکیب توضیح کوتاه، توضیح کامل و ویژگی‌های ووکامرس برای نمایش در آگهی */
export function buildWordPressListingDescription(dto: WordPressProductDto): string {
  const parts: string[] = [];

  const shortBlock = normalizeHtmlBlock(dto.shortDescription);
  const fullBlock = normalizeHtmlBlock(dto.description);
  const attributesBlock = buildAttributesHtml(dto.attributes ?? []);

  if (shortBlock) {
    parts.push(shortBlock);
  }
  if (fullBlock && fullBlock !== shortBlock) {
    parts.push(fullBlock);
  }
  if (attributesBlock) {
    parts.push(attributesBlock);
  }

  const combined = parts.join('\n').trim();
  if (combined) {
    return sanitizeRichHtml(combined);
  }

  return `<p>${escapeHtml(dto.title.trim())}</p>`;
}
