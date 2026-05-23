import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
  normalizeTicketMessage,
} from './ticket-message.util';

describe('ticket-message.util', () => {
  it('formatTicketMessageBody prefixes سلام؛ and separates paragraphs', () => {
    const body = formatTicketMessageBody(['پاراگراف اول.', 'پاراگراف دوم.']);
    expect(body).toBe('سلام؛\n\nپاراگراف اول.\n\nپاراگراف دوم.');
  });

  it('buildOrderTicketSubject includes headline and order tag', () => {
    const subject = buildOrderTicketSubject('لغو سفارش', 'abc123def456');
    expect(subject).toContain('لغو سفارش');
    expect(subject).toContain('#DEF456');
    expect(subject).toContain('[ORDER:abc123def456]');
  });

  it('normalizeTicketMessage upgrades legacy greeting', () => {
    const body = normalizeTicketMessage('سلام،\nمتن پیام.');
    expect(body.startsWith('سلام؛')).toBe(true);
    expect(body).toContain('متن پیام.');
    expect(body).not.toContain('سلام،');
  });
});
