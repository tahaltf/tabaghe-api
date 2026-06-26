import { ValidationPipe } from '@nestjs/common';
import { UpdateListingDto } from './update-listing.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe('UpdateListingDto galleryOrder', () => {
  it('accepts mixed existing and new gallery slots', async () => {
    const galleryOrder = [
      { type: 'existing', name: '81906d5a-793a-4c56-97d5-f5601d9b8d9f.jpg' },
      { type: 'existing', name: 'ce65c088-7a0b-42ce-8294-925d9015e8fb.jpg' },
      { type: 'new', fileIndex: 0 },
      { type: 'new', fileIndex: 1 },
    ];

    const result = await pipe.transform(
      { galleryOrder: JSON.stringify(galleryOrder) },
      { type: 'body', metatype: UpdateListingDto },
    );

    expect(result.galleryOrder).toEqual(galleryOrder);
  });

  it('rejects unknown keys inside gallery slots', async () => {
    await expect(
      pipe.transform(
        {
          galleryOrder: [{ type: 'existing', name: 'a.jpg', extra: true }],
        },
        { type: 'body', metatype: UpdateListingDto },
      ),
    ).rejects.toThrow();
  });
});
