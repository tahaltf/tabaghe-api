import { coerceLandingSections } from './landing-sections.util';
import {
  loadSellerLandingSeedSections,
  SELLER_LANDING_SECTION_COUNT,
} from './seller-landing.seed';

describe('seller landing seed', () => {
  it('has the full seller page section count', () => {
    const sections = loadSellerLandingSeedSections();
    expect(sections.length).toBe(SELLER_LANDING_SECTION_COUNT);
    expect(coerceLandingSections(sections).length).toBe(
      SELLER_LANDING_SECTION_COUNT,
    );
  });
});
