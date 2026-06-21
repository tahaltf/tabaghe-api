import { coerceLandingSections } from './landing-sections.util';

describe('landing-sections.util regression', () => {
  it('drops invalid section types consistently for admin/public count', () => {
    const raw = [
      { id: 'a', type: 'hero', props: {} },
      { id: 'b', type: 'invalid-type', props: {} },
      { id: 'c', type: 'cta', props: {} },
    ];
    expect(coerceLandingSections(raw)).toHaveLength(2);
  });
});
