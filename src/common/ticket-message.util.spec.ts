import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
  normalizeTicketMessage,
} from './ticket-message.util';

describe('ticket-message.util', () => {
  it('formatTicketMessageBody joins paragraphs without greeting prefix', () => {
    const body = formatTicketMessageBody(['پاراگراف اول.', 'پاراگراف دوم.']);
    expect(body).toBe('پاراگراف اول.\n\nپاراگراف دوم.');
  });

  it('buildOrderTicketSubject includes headline and order tag', () => {
    const subject = buildOrderTicketSubject('لغو سفارش', 'abc123def456');
    expect(subject).toContain('لغو سفارش');
    expect(subject).toContain('#DEF456');
    expect(subject).toContain('[ORDER:abc123def456]');
  });


  it('normalizeTicketMessage preserves user text as typed', () => {
    expect(normalizeTicketMessage('سلام،\nمتن پیام.')).toBe('سلام،\nمتن پیام.');
    expect(normalizeTicketMessage('  متن  ')).toBe('متن');
  });
});
