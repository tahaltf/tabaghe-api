import { ValidationPipe } from '@nestjs/common';
import {
  AdminCreateLandingPageDto,
  AdminUpdateLandingPageDto,
} from './admin-landing-page.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const sampleSections = [
  { id: 'sec-1', type: 'hero', props: { headline: 'Hello' } },
  { id: 'sec-2', type: 'cta', props: { headline: 'Go' } },
];

describe('AdminLandingPageDto sections preservation', () => {
  it('preserves landing block fields on update', async () => {
    const result = await pipe.transform(
      { title: 'Test', sections: sampleSections },
      { type: 'body', metatype: AdminUpdateLandingPageDto },
    );
    expect(result.sections).toEqual(sampleSections);
  });

  it('preserves landing block fields on create', async () => {
    const result = await pipe.transform(
      { title: 'Test', sections: sampleSections },
      { type: 'body', metatype: AdminCreateLandingPageDto },
    );
    expect(result.sections).toEqual(sampleSections);
  });

  it('rejects unknown top-level keys on each block', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Test',
          sections: [
            {
              id: 'sec-1',
              type: 'hero',
              props: { headline: 'Hello' },
              hackerField: 'drop-me',
            },
          ],
        },
        { type: 'body', metatype: AdminUpdateLandingPageDto },
      ),
    ).rejects.toThrow();
  });
});
