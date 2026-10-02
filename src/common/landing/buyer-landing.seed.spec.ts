import { coerceLandingSections } from './landing-sections.util';
import {
  BUYER_LANDING_SECTION_COUNT,
  loadBuyerLandingSeedSections,
} from './buyer-landing.seed';

describe('buyer landing seed', () => {
  it('has the full buyer page section count', () => {
    const sections = loadBuyerLandingSeedSections();
    expect(sections.length).toBe(BUYER_LANDING_SECTION_COUNT);
    expect(coerceLandingSections(sections).length).toBe(
      BUYER_LANDING_SECTION_COUNT,
    );
  });
});
