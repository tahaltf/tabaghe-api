import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ExchangePayer,
  ItemCondition,
  ListingType,
  User,
} from '@prisma/client';
import { Telegraf, Context } from 'telegraf';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../../infrastructure/cache/ttl-cache.service';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { CreateListingDto } from '../../listing/dto/create-listing.dto';
import { SETTING_KEYS } from '../../admin/services/admin-settings.service';

type LinkedUser = Pick<User, 'id' | 'telegramId' | 'isActive'>;

type BotState = {
  linkedUser?: LinkedUser;
};

type BotContext = Context & { state: BotState };

const WIZARD_TTL_SECONDS = 30 * 60;
const LINK_TTL_SECONDS = 5 * 60;
const DEFAULT_PROXY_HEALTHCHECK_INTERVAL_SECONDS = 10;
const PROXY_CHECK_TIMEOUT_MS = 3500;

type WizardStep =
  | 'awaiting_title'
  | 'awaiting_type'
  | 'awaiting_categoryId'
  | 'awaiting_condition'
  | 'awaiting_provinceId'
  | 'awaiting_cityId'
  | 'awaiting_direct_price'
  | 'awaiting_auction_basePrice'
  | 'awaiting_auction_endDatetime'
  | 'awaiting_exchange_desiredTitle'
  | 'awaiting_exchange_desiredCategoryId'
  | 'ready';

type WizardState = {
  v: 1;
  step: WizardStep;
  telegramId: string;
  listing: {
    imageFileId: string;
    description: string;

    title?: string;
    type?: ListingType;
    categoryId?: string;
    condition?: ItemCondition;
    provinceId?: string;
    cityId?: string;

    directPrice?: string; // decimal as string for Prisma
    auctionBasePrice?: string; // decimal as string for Prisma
    auctionEndDatetime?: string; // ISO
    exchangeDesiredTitle?: string;
    exchangeDesiredCategoryId?: string;
  };
};

function SafeTelegrafHandler(): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as unknown;
    if (typeof original !== 'function') return;

    descriptor.value = async function (...args: unknown[]) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await (original as any).apply(this, args);
      } catch (err) {
        const ctx = args[0] as BotContext | undefined;
        await (this as TelegramBotService).handleHandlerError(err, ctx);
      }
    };
  };
}

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, '\n').trim();
}

function isLikelyCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

function parseListingType(text: string): ListingType | null {
  const v = text.trim().toUpperCase();
  if (v === 'DIRECT') return ListingType.DIRECT;
  if (v === 'AUCTION') return ListingType.AUCTION;
  if (v === 'EXCHANGE') return ListingType.EXCHANGE;
  return null;
}

function parseItemCondition(text: string): ItemCondition | null {
  const v = text.trim().toUpperCase();
  if (v === 'NEW') return ItemCondition.NEW;
  if (v === 'USED') return ItemCondition.USED;
  return null;
}

function parseDecimalString(text: string): string | null {
  const raw = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  if (Number(raw) <= 0) return null;
  return raw;
}

function pickLargestPhotoFileId(
  photos: Array<{ file_id: string; file_size?: number }>,
): string {
  const best = photos.reduce((acc, cur) => {
    const accSize = acc.file_size ?? -1;
    const curSize = cur.file_size ?? -1;
    return curSize >= accSize ? cur : acc;
  }, photos[0]);
  return best.file_id;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf<BotContext> | null = null;
  private botFingerprint: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly listingCommand: ListingCommandService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshFromAdminSettings();
    // Timer interval itself is admin-managed (falls back to 10s)
    this.refreshTimer = setInterval(() => {
      void this.refreshFromAdminSettings();
    }, DEFAULT_PROXY_HEALTHCHECK_INTERVAL_SECONDS * 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    await this.stopBotIfRunning('shutdown');
  }

  private registerMiddlewares(bot: Telegraf<BotContext>): void {
    bot.use(async (ctx, next) => {
      const from = ctx.from;
      if (!from) return;

      // Allow /start (linking) without being linked.
      if (ctx.message && 'text' in ctx.message) {
        const text = String(ctx.message.text ?? '').trim();
        if (text.startsWith('/start')) {
          return next();
        }
      }

      const telegramId = String(from.id);
      const linked = await this.findLinkedUserByTelegramId(telegramId);
      if (!linked) {
        return;
      }

      ctx.state.linkedUser = linked;
      return next();
    });
  }

  private registerHandlers(bot: Telegraf<BotContext>): void {
    bot.start(this.onStart.bind(this));
    bot.command('link', this.onLinkCommand.bind(this));
    bot.command('cancel', this.onCancel.bind(this));

    bot.on('photo', this.onPhoto.bind(this));
    bot.on('text', this.onText.bind(this));
  }

  private wizardKey(telegramId: string): string {
    return `telegram:wizard:${telegramId}`;
  }

  private linkKey(telegramId: string): string {
    return `telegram:link:${telegramId}`;
  }

  private async setLinkPending(telegramId: string): Promise<void> {
    await this.cache.set(
      this.linkKey(telegramId),
      { pending: true },
      LINK_TTL_SECONDS,
    );
  }

  private async isLinkPending(telegramId: string): Promise<boolean> {
    const v = await this.cache.get<{ pending?: boolean }>(this.linkKey(telegramId));
    return !!v?.pending;
  }

  private async clearLinkPending(telegramId: string): Promise<void> {
    await this.cache.delete(this.linkKey(telegramId));
  }

  private async getWizard(telegramId: string): Promise<WizardState | null> {
    return await this.cache.get<WizardState>(this.wizardKey(telegramId));
  }

  private async setWizard(state: WizardState): Promise<void> {
    await this.cache.set(this.wizardKey(state.telegramId), state, WIZARD_TTL_SECONDS);
  }

  private async clearWizard(telegramId: string): Promise<void> {
    await this.cache.delete(this.wizardKey(telegramId));
  }

  private async findLinkedUserByTelegramId(
    telegramId: string,
  ): Promise<LinkedUser | null> {
    const cacheKey = `telegram:linkedUser:${telegramId}`;
    const cached = await this.cache.get<LinkedUser>(cacheKey);
    if (cached) return cached;

    const user = await this.prisma.user.findFirst({
      where: { telegramId, isActive: true },
      select: { id: true, telegramId: true, isActive: true },
    });
    if (!user) return null;
    await this.cache.set(cacheKey, user, 60);
    return user;
  }

  async handleHandlerError(err: unknown, ctx?: BotContext): Promise<void> {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';

    const meta = {
      telegramId: ctx?.from?.id ? String(ctx.from.id) : undefined,
      updateType: ctx?.updateType,
    };

    this.logger.error(`Telegram handler error: ${message}`, (err as Error | undefined)?.stack);
    this.logger.debug(JSON.stringify(meta));

    if (!ctx) return;
    try {
      await ctx.reply('خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    } catch {
      // ignore
    }
  }

  private async refreshFromAdminSettings(): Promise<void> {
    try {
      const rows = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              SETTING_KEYS.TELEGRAM_BOT_ENABLED,
              SETTING_KEYS.TELEGRAM_BOT_TOKEN,
              SETTING_KEYS.TELEGRAM_PROXY_URL,
              SETTING_KEYS.TELEGRAM_PROXY_POOL,
              SETTING_KEYS.TELEGRAM_PROXY_HEALTHCHECK_INTERVAL_SECONDS,
            ],
          },
        },
        select: { key: true, value: true },
      });

      const byKey = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));
      const enabledRaw = (byKey.get(SETTING_KEYS.TELEGRAM_BOT_ENABLED) ?? '').toLowerCase();
      const enabled = enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes';
      const token = byKey.get(SETTING_KEYS.TELEGRAM_BOT_TOKEN) ?? '';
      const proxyUrl = byKey.get(SETTING_KEYS.TELEGRAM_PROXY_URL) ?? '';
      const proxyPoolRaw = byKey.get(SETTING_KEYS.TELEGRAM_PROXY_POOL) ?? '';
      const intervalSecondsRaw =
        byKey.get(SETTING_KEYS.TELEGRAM_PROXY_HEALTHCHECK_INTERVAL_SECONDS) ?? '';

      if (!enabled) {
        await this.stopBotIfRunning('disabled_by_admin');
        return;
      }

      if (!token) {
        this.logger.warn(
          'Telegram bot is enabled but token is missing in admin settings; stopping bot.',
        );
        await this.stopBotIfRunning('missing_config');
        return;
      }

      const proxies = this.parseProxyPool(proxyPoolRaw, proxyUrl);
      if (proxies.length === 0) {
        this.logger.warn(
          'Telegram bot is enabled but no proxy is configured (pool empty and TELEGRAM_PROXY_URL empty); stopping bot.',
        );
        await this.stopBotIfRunning('missing_proxy');
        return;
      }

      const intervalSeconds = this.parsePositiveInt(
        intervalSecondsRaw,
        DEFAULT_PROXY_HEALTHCHECK_INTERVAL_SECONDS,
      );
      this.ensureRefreshInterval(intervalSeconds);

      const selectedProxy = await this.selectHealthyProxy(token, proxies);
      if (!selectedProxy) {
        this.logger.warn(
          `No healthy Telegram proxy found (pool size=${proxies.length}); stopping bot.`,
        );
        await this.stopBotIfRunning('no_healthy_proxy');
        return;
      }

      const fingerprint = `${token.slice(0, 10)}...|${selectedProxy}`;
      if (this.bot && this.botFingerprint === fingerprint) {
        return;
      }

      await this.stopBotIfRunning('config_changed');
      await this.startBot(token, selectedProxy, fingerprint);
    } catch (err) {
      this.logger.error(
        `Failed to refresh Telegram bot settings: ${(err as Error)?.message ?? String(err)}`,
        (err as Error | undefined)?.stack,
      );
    }
  }

  private parseProxyPool(poolRaw: string, fallbackSingle: string): string[] {
    const out: string[] = [];
    const push = (v: string) => {
      const t = v.trim();
      if (!t) return;
      if (!out.includes(t)) out.push(t);
    };

    if (poolRaw) {
      // JSON array OR newline-separated
      const trimmed = poolRaw.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof item === 'string') push(item);
            }
          }
        } catch {
          // fall back to newline parsing
          for (const line of trimmed.split('\n')) push(line);
        }
      } else {
        for (const line of trimmed.split('\n')) push(line);
      }
    }

    if (out.length === 0 && fallbackSingle) {
      push(fallbackSingle);
    }

    return out;
  }

  private parsePositiveInt(raw: string, fallback: number): number {
    const n = Number(String(raw ?? '').trim());
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
  }

  private ensureRefreshInterval(intervalSeconds: number): void {
    // If admin changes interval, recreate timer.
    // We intentionally keep this logic lightweight and resilient.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentMs = (this.refreshTimer as any)?._idleTimeout as number | undefined;
    const desiredMs = Math.max(3, intervalSeconds) * 1000;
    if (currentMs && Math.abs(currentMs - desiredMs) < 250) return;

    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      void this.refreshFromAdminSettings();
    }, desiredMs);
  }

  private async selectHealthyProxy(
    token: string,
    proxies: string[],
  ): Promise<string | null> {
    // Prefer last-known-good proxy (cached) for faster steady-state.
    const stickyKey = 'telegram:proxy:lastGood';
    const last = await this.cache.get<string>(stickyKey);
    const ordered = last
      ? [last, ...proxies.filter((p) => p !== last)]
      : proxies;

    const maxChecks = Math.min(5, ordered.length);
    for (let i = 0; i < maxChecks; i++) {
      const proxyUrl = ordered[i]!;
      const ok = await this.checkProxyHealth(token, proxyUrl);
      if (ok) {
        await this.cache.set(stickyKey, proxyUrl, 6 * 60);
        return proxyUrl;
      }
    }
    return null;
  }

  private async checkProxyHealth(token: string, proxyUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_CHECK_TIMEOUT_MS);
    try {
      const agent = this.createProxyAgent(proxyUrl);
      const probe = new Telegraf<BotContext>(token, {
        telegram: {
          agent: agent as any,
          attachmentAgent: agent as any,
        },
      });
      await probe.telegram.getMe();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private createProxyAgent(proxyUrl: string): unknown {
    const lower = proxyUrl.trim().toLowerCase();
    if (lower.startsWith('socks5://') || lower.startsWith('socks://')) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SocksProxyAgent } = require('socks-proxy-agent') as {
        SocksProxyAgent: new (proxy: string) => unknown;
      };
      return new SocksProxyAgent(proxyUrl);
    }
    // Default: HTTP/HTTPS proxy for HTTPS requests to Telegram API
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpsProxyAgent } = require('https-proxy-agent') as {
      HttpsProxyAgent: new (proxy: string) => unknown;
    };
    return new HttpsProxyAgent(proxyUrl);
  }

  private async startBot(token: string, proxyUrl: string, fingerprint: string): Promise<void> {
    const agent = this.createProxyAgent(proxyUrl) as any;
    const bot = new Telegraf<BotContext>(token, {
      telegram: {
        agent,
        attachmentAgent: agent,
      },
    });

    this.registerMiddlewares(bot);
    this.registerHandlers(bot);

    bot.catch((err, ctx) => {
      this.logger.error(
        `Telegraf error: ${(err as Error)?.message ?? String(err)}`,
        (err as Error | undefined)?.stack,
      );
      void ctx
        .reply('خطایی رخ داد. لطفاً چند دقیقه بعد دوباره تلاش کنید.')
        .catch(() => undefined);
    });

    await bot.launch({ dropPendingUpdates: true });
    this.bot = bot;
    this.botFingerprint = fingerprint;
    this.logger.log('Telegram bot launched (admin-managed).');
  }

  private async stopBotIfRunning(reason: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.stop();
    } catch (err) {
      this.logger.warn(
        `Telegram bot stop failed (${reason}): ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      this.bot = null;
      this.botFingerprint = null;
    }
  }

  @SafeTelegrafHandler()
  private async onStart(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!telegramId) return;

    const rawText = ctx.message && 'text' in ctx.message ? String(ctx.message.text) : '';
    const token =
      (ctx as any).startPayload?.trim?.() ||
      rawText.replace(/^\/start(@\w+)?/i, '').trim();

    if (!token) {
      await this.setLinkPending(telegramId);
      await ctx.reply(
        'برای اتصال حساب، توکن را همینجا ارسال کنید.\n(اگر توکن ندارید، از پنل کاربری → تنظیمات → تلگرام بسازید.)',
      );
      return;
    }

    const result = await this.linkTelegramAccountByToken(token, telegramId);

    if (!result.ok) {
      if (result.reason === 'telegram_already_linked') {
        await ctx.reply('این حساب تلگرام قبلاً به حساب دیگری متصل شده است.');
        return;
      }
      await ctx.reply('توکن نامعتبر یا منقضی است. لطفاً از داخل حساب کاربری، توکن جدید بگیرید.');
      return;
    }

    await this.clearLinkPending(telegramId);
    await this.cache.delete(`telegram:linkedUser:${telegramId}`);
    await ctx.reply('حساب شما با موفقیت به تلگرام متصل شد. حالا یک عکس با کپشن ارسال کنید تا آگهی ثبت شود.');
  }

  @SafeTelegrafHandler()
  private async onLinkCommand(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!telegramId) return;
    await this.setLinkPending(telegramId);
    await ctx.reply('توکن اتصال را ارسال کنید.');
  }

  @SafeTelegrafHandler()
  private async onCancel(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!telegramId) return;
    await this.clearLinkPending(telegramId);
    await this.clearWizard(telegramId);
    await ctx.reply('فرآیند ثبت آگهی لغو شد. برای شروع، یک عکس با کپشن ارسال کنید.');
  }

  @SafeTelegrafHandler()
  private async onPhoto(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
    const linkedUser = ctx.state.linkedUser;
    if (!telegramId || !linkedUser) return;

    const msg: any = ctx.message;
    const photos = (msg?.photo ?? []) as Array<{
      file_id: string;
      file_size?: number;
    }>;
    if (!Array.isArray(photos) || photos.length === 0) return;

    const imageFileId = pickLargestPhotoFileId(photos);
    const description = normalizeText(String(msg?.caption ?? ''));

    const state: WizardState = {
      v: 1,
      step: 'awaiting_title',
      telegramId,
      listing: { imageFileId, description },
    };

    await this.setWizard(state);
    await ctx.reply('عنوان آگهی را ارسال کنید.');
  }

  @SafeTelegrafHandler()
  private async onText(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!telegramId) return;
    const linkedUser = ctx.state.linkedUser;

    const text = normalizeText(String((ctx.message as any)?.text ?? ''));
    if (!text) return;
    if (isLikelyCommand(text)) return;

    // Linking wizard: user asked to link and is sending token.
    if (!linkedUser && (await this.isLinkPending(telegramId))) {
      const token = text;
      const result = await this.linkTelegramAccountByToken(token, telegramId);
      if (!result.ok) {
        await ctx.reply(
          result.reason === 'telegram_already_linked'
            ? 'این حساب تلگرام قبلاً به حساب دیگری متصل شده است.'
            : 'توکن نامعتبر یا منقضی است. لطفاً از داخل حساب کاربری، توکن جدید بگیرید.',
        );
        return;
      }

      // Best-effort delete the token message (privacy).
      try {
        await ctx.deleteMessage();
      } catch {
        // ignore
      }

      await this.clearLinkPending(telegramId);
      await this.cache.delete(`telegram:linkedUser:${telegramId}`);
      await ctx.reply(
        'اتصال انجام شد. حالا یک عکس با کپشن ارسال کنید تا آگهی ثبت شود.',
      );
      return;
    }

    if (!linkedUser) {
      await ctx.reply(
        'برای استفاده از بات، ابتدا حساب خود را متصل کنید. از پنل کاربری → تنظیمات → تلگرام توکن بسازید و سپس اینجا `/start <token>` را بزنید.',
        { parse_mode: 'Markdown' as any },
      );
      return;
    }

    const wizard = await this.getWizard(telegramId);
    if (!wizard) {
      await ctx.reply('برای ثبت آگهی، ابتدا یک عکس با کپشن ارسال کنید. (برای لغو: /cancel)');
      return;
    }

    const next = await this.applyWizardInput(wizard, text, ctx);
    if (!next) return;

    if (next.step === 'ready') {
      await this.createListingFromWizard(next, linkedUser.id, ctx);
      await this.clearWizard(telegramId);
      return;
    }

    await this.setWizard(next);
  }

  private async applyWizardInput(
    wizard: WizardState,
    text: string,
    ctx: BotContext,
  ): Promise<WizardState | null> {
    const w = { ...wizard, listing: { ...wizard.listing } };

    switch (w.step) {
      case 'awaiting_title': {
        w.listing.title = text;
        w.step = 'awaiting_type';
        await ctx.reply('نوع آگهی را مشخص کنید: DIRECT یا AUCTION یا EXCHANGE');
        return w;
      }

      case 'awaiting_type': {
        const type = parseListingType(text);
        if (!type) {
          await ctx.reply('نوع نامعتبر است. فقط یکی از این‌ها: DIRECT / AUCTION / EXCHANGE');
          return null;
        }
        w.listing.type = type;
        w.step = 'awaiting_categoryId';
        await ctx.reply('شناسه دسته‌بندی (categoryId) را ارسال کنید.');
        return w;
      }

      case 'awaiting_categoryId': {
        w.listing.categoryId = text;
        w.step = 'awaiting_condition';
        await ctx.reply('وضعیت کالا را ارسال کنید: NEW یا USED');
        return w;
      }

      case 'awaiting_condition': {
        const cond = parseItemCondition(text);
        if (!cond) {
          await ctx.reply('مقدار نامعتبر است. فقط: NEW یا USED');
          return null;
        }
        w.listing.condition = cond;
        w.step = 'awaiting_provinceId';
        await ctx.reply('شناسه استان (provinceId) را ارسال کنید.');
        return w;
      }

      case 'awaiting_provinceId': {
        w.listing.provinceId = text;
        w.step = 'awaiting_cityId';
        await ctx.reply('شناسه شهر (cityId) را ارسال کنید.');
        return w;
      }

      case 'awaiting_cityId': {
        w.listing.cityId = text;
        const type = w.listing.type;
        if (type === ListingType.DIRECT) {
          w.step = 'awaiting_direct_price';
          await ctx.reply('قیمت (عدد) را ارسال کنید.');
          return w;
        }
        if (type === ListingType.AUCTION) {
          w.step = 'awaiting_auction_basePrice';
          await ctx.reply('قیمت پایه مزایده (عدد) را ارسال کنید.');
          return w;
        }
        if (type === ListingType.EXCHANGE) {
          w.step = 'awaiting_exchange_desiredTitle';
          await ctx.reply('نام کالای درخواستی برای معاوضه را ارسال کنید.');
          return w;
        }
        await ctx.reply('نوع آگهی مشخص نیست. لطفاً دوباره از ابتدا شروع کنید. (/cancel)');
        return null;
      }

      case 'awaiting_direct_price': {
        const price = parseDecimalString(text);
        if (!price) {
          await ctx.reply('قیمت نامعتبر است. یک عدد بزرگ‌تر از صفر ارسال کنید.');
          return null;
        }
        w.listing.directPrice = price;
        w.step = 'ready';
        return w;
      }

      case 'awaiting_auction_basePrice': {
        const basePrice = parseDecimalString(text);
        if (!basePrice) {
          await ctx.reply('قیمت پایه نامعتبر است. یک عدد بزرگ‌تر از صفر ارسال کنید.');
          return null;
        }
        w.listing.auctionBasePrice = basePrice;
        w.step = 'awaiting_auction_endDatetime';
        await ctx.reply(
          'زمان پایان مزایده را ارسال کنید (مثلاً `2026-07-10T18:00:00+03:30`).',
          { parse_mode: 'Markdown' },
        );
        return w;
      }

      case 'awaiting_auction_endDatetime': {
        const d = new Date(text);
        if (Number.isNaN(d.getTime())) {
          await ctx.reply('فرمت تاریخ/زمان نامعتبر است. لطفاً به صورت ISO ارسال کنید.');
          return null;
        }
        w.listing.auctionEndDatetime = d.toISOString();
        w.step = 'ready';
        return w;
      }

      case 'awaiting_exchange_desiredTitle': {
        w.listing.exchangeDesiredTitle = text;
        w.step = 'awaiting_exchange_desiredCategoryId';
        await ctx.reply('شناسه دسته‌بندی کالای درخواستی (desiredCategoryId) را ارسال کنید.');
        return w;
      }

      case 'awaiting_exchange_desiredCategoryId': {
        w.listing.exchangeDesiredCategoryId = text;
        w.step = 'ready';
        return w;
      }

      default: {
        await ctx.reply('وضعیت نامعتبر است. لطفاً دوباره تلاش کنید. (/cancel)');
        return null;
      }
    }
  }

  private async createListingFromWizard(
    wizard: WizardState,
    userId: string,
    ctx: BotContext,
  ): Promise<void> {
    const l = wizard.listing;

    const missing: string[] = [];
    const requireText = (v: string | undefined, name: string) => {
      if (!v || !v.trim()) missing.push(name);
    };

    requireText(l.title, 'title');
    if (!l.type) missing.push('type');
    requireText(l.categoryId, 'categoryId');
    if (!l.condition) missing.push('condition');
    requireText(l.provinceId, 'provinceId');
    requireText(l.cityId, 'cityId');

    if (missing.length) {
      await ctx.reply(`اطلاعات ناقص است: ${missing.join(', ')}. لطفاً /cancel و دوباره شروع کنید.`);
      return;
    }

    const dto: CreateListingDto = {
      type: l.type!,
      title: l.title!,
      categoryId: l.categoryId!,
      condition: l.condition!,
      description: l.description,
      provinceId: l.provinceId!,
      cityId: l.cityId!,
      gallery: [l.imageFileId],
      thumbnail: l.imageFileId,
      // optional fields omitted; ListingCommandService applies defaults
    } as CreateListingDto;

    if (l.type === ListingType.DIRECT) {
      if (!l.directPrice) {
        await ctx.reply('قیمت فروش مشخص نیست. لطفاً /cancel و دوباره شروع کنید.');
        return;
      }
      (dto as any).direct = {
        price: l.directPrice,
        allowExchange: false,
        shippingMethods: [],
      };
    }

    if (l.type === ListingType.AUCTION) {
      if (!l.auctionBasePrice || !l.auctionEndDatetime) {
        await ctx.reply('اطلاعات مزایده ناقص است. لطفاً /cancel و دوباره شروع کنید.');
        return;
      }
      (dto as any).auction = {
        basePrice: l.auctionBasePrice,
        endDatetime: new Date(l.auctionEndDatetime),
      };
    }

    if (l.type === ListingType.EXCHANGE) {
      if (!l.exchangeDesiredTitle || !l.exchangeDesiredCategoryId) {
        await ctx.reply('اطلاعات معاوضه ناقص است. لطفاً /cancel و دوباره شروع کنید.');
        return;
      }
      (dto as any).exchange = {
        desiredTitle: l.exchangeDesiredTitle,
        desiredCategoryId: l.exchangeDesiredCategoryId,
      };
      (dto as any).exchangePayer = ExchangePayer.NONE;
    }

    const created = await this.listingCommand.create(userId, dto);
    const id = (created as any)?.id ?? (created as any)?.listing?.id;

    await ctx.reply(
      `آگهی شما با موفقیت ثبت شد و در انتظار تایید است.\nشناسه: ${String(id)}`,
    );
  }

  private async linkTelegramAccountByToken(
    token: string,
    telegramId: string,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: 'invalid_token' | 'telegram_already_linked' }
  > {
    return await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { telegramToken: token, isActive: true },
        select: { id: true },
      });
      if (!target) {
        return { ok: false as const, reason: 'invalid_token' as const };
      }

      const existing = await tx.user.findFirst({
        where: { telegramId, isActive: true },
        select: { id: true },
      });
      if (existing && existing.id !== target.id) {
        return { ok: false as const, reason: 'telegram_already_linked' as const };
      }

      await tx.user.update({
        where: { id: target.id },
        data: {
          telegramId,
          telegramToken: null,
        },
      });

      return { ok: true as const };
    });
  }
}

