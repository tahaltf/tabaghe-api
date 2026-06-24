import {
  buildAcceptAttribute,
  parseTicketAttachmentMaxSizeMb,
  parseTicketAttachmentMimeTypes,
} from './ticket-attachment-settings.util';

describe('ticket-attachment-settings.util', () => {
  it('returns defaults when mime setting is empty', () => {
    expect(parseTicketAttachmentMimeTypes(null)).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
  });

  it('filters unknown mime types from admin setting', () => {
    const parsed = parseTicketAttachmentMimeTypes(
      JSON.stringify(['image/png', 'application/zip', 'application/pdf']),
    );
    expect(parsed).toEqual(['image/png', 'application/pdf']);
  });

  it('clamps max size between 1 and 20 MB', () => {
    expect(parseTicketAttachmentMaxSizeMb('0')).toBe(5);
    expect(parseTicketAttachmentMaxSizeMb('99')).toBe(20);
    expect(parseTicketAttachmentMaxSizeMb('8')).toBe(8);
  });

  it('builds accept attribute from allowed mime types', () => {
    expect(buildAcceptAttribute(['image/png', 'application/pdf'])).toContain(
      'image/png',
    );
    expect(buildAcceptAttribute(['image/png', 'application/pdf'])).toContain(
      'application/pdf',
    );
  });
});
