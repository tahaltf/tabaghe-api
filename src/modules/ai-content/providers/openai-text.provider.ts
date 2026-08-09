import { Injectable, Logger } from '@nestjs/common';
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import type { StoryGenerationInput } from '../utils/story-prompt.builder';
import { buildStoryCaptionPrompt } from '../utils/story-prompt.builder';

@Injectable()
export class OpenAiTextProvider {
  private readonly logger = new Logger(OpenAiTextProvider.name);

  constructor(private readonly settings: AiContentSettingsService) {}

  async generateStoryCaption(input: StoryGenerationInput): Promise<string> {
    const apiKey = this.settings.getOpenAiApiKey();
    const { system, user } = buildStoryCaptionPrompt(input);

    if (!apiKey) {
      return this.fallbackCaption(input);
    }

    const model = await this.settings.getTextModel();
    const baseUrl = this.settings.getOpenAiBaseUrl();

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 300,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Liara text failed: ${res.status} ${body}`);
        return this.fallbackCaption(input);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text || this.fallbackCaption(input);
    } catch (err) {
      this.logger.warn(`Liara text error: ${String((err as Error).message)}`);
      return this.fallbackCaption(input);
    }
  }

  private fallbackCaption(input: StoryGenerationInput): string {
    const price = input.priceLabel ? `\n💰 ${input.priceLabel}` : '';
    return `✨ ${input.listingTitle}${price}\n\n${input.listingDescription.slice(0, 120)}...\n\n🛒 همین حالا در طبقه ببین و بخر!`;
  }
}
