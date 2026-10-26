/**
 * Batch-optimize existing uploads (listings / banners / brand) to lighter WebP.
 *
 * Usage (from tabaghe-api):
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-optimize-uploads.ts
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-optimize-uploads.ts --targets=banners,listings
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-optimize-uploads.ts --force
 *
 * Note: This CLI only writes optimized files. To remap SystemSetting paths
 * (banner / hero / logos), call POST /admin/image-optimize/run with remapSettings=true
 * or re-save those assets from the admin panel.
 */
import { ImageOptimizeService, type OptimizeTarget } from '../src/common/upload/image-optimize.service';

function parseTargets(argv: string[]): OptimizeTarget[] {
  const arg = argv.find((a) => a.startsWith('--targets='));
  if (!arg) return ['banners', 'listings', 'brand'];
  const raw = arg.slice('--targets='.length);
  const allowed = new Set<OptimizeTarget>(['banners', 'listings', 'brand']);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is OptimizeTarget => allowed.has(s as OptimizeTarget));
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const targets = parseTargets(argv);
  const service = new ImageOptimizeService();

  console.log(`Optimizing targets: ${targets.join(', ')} (force=${force})`);
  const summaries = await service.optimizeTargets(targets, { force });
  for (const s of summaries) {
    console.log(
      `[${s.target}] processed=${s.processed} skipped=${s.skipped} failed=${s.failed} saved≈${Math.round(s.bytesSaved / 1024)}KB`,
    );
    for (const r of s.results) {
      if (r.error) console.error('  fail', r.source, r.error);
      else if (!r.skipped) console.log('  ok', r.source, '→', r.filename);
    }
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
