/** استان‌ها و شهرهای ایران برای seed + اسلاگ SEO (یکتا در کل جدول Location) */
export type IranCitySeed = { name: string; slug: string };
export type IranProvinceSeed = {
  name: string;
  slug: string;
  cities: IranCitySeed[];
};

export const IRAN_LOCATION_SEED: IranProvinceSeed[] = [
  {
    name: 'آذربایجان شرقی',
    slug: 'ostan-east-azerbaijan',
    cities: [
      { name: 'تبریز', slug: 'tabriz' },
      { name: 'مراغه', slug: 'maragheh' },
      { name: 'مرند', slug: 'marand' },
      { name: 'میانه', slug: 'mianeh' },
      { name: 'اهر', slug: 'ahar' },
      { name: 'بناب', slug: 'bonab' },
      { name: 'سراب', slug: 'sarab' },
      { name: 'آذرشهر', slug: 'azarshahr' },
    ],
  },
  {
    name: 'آذربایجان غربی',
    slug: 'ostan-west-azerbaijan',
    cities: [
      { name: 'ارومیه', slug: 'urmia' },
      { name: 'خوی', slug: 'khoy' },
      { name: 'بوکان', slug: 'bukan' },
      { name: 'مهاباد', slug: 'mahabad' },
      { name: 'میاندوآب', slug: 'miandoab' },
      { name: 'سلماس', slug: 'salmas' },
      { name: 'پیرانشهر', slug: 'piranshahr' },
      { name: 'نقده', slug: 'naqadeh' },
    ],
  },
  {
    name: 'اردبیل',
    slug: 'ostan-ardabil',
    cities: [
      { name: 'اردبیل', slug: 'ardabil' },
      { name: 'پارس‌آباد', slug: 'parsabad' },
      { name: 'مشگین‌شهر', slug: 'meshginshahr' },
      { name: 'خلخال', slug: 'khalkhal' },
      { name: 'گرمی', slug: 'germi' },
      { name: 'نمین', slug: 'namin' },
    ],
  },
  {
    name: 'اصفهان',
    slug: 'ostan-isfahan',
    cities: [
      { name: 'اصفهان', slug: 'isfahan' },
      { name: 'کاشان', slug: 'kashan' },
      { name: 'خمینی‌شهر', slug: 'khomeinishahr' },
      { name: 'نجف‌آباد', slug: 'najafabad' },
      { name: 'شاهین‌شهر', slug: 'shahinshahr' },
      { name: 'شهرضا', slug: 'shahreza' },
      { name: 'فولادشهر', slug: 'fooladshahr' },
      { name: 'مبارکه', slug: 'mobarakeh' },
    ],
  },
  {
    name: 'البرز',
    slug: 'ostan-alborz',
    cities: [
      { name: 'کرج', slug: 'karaj' },
      { name: 'فردیس', slug: 'fardis' },
      { name: 'کمال‌شهر', slug: 'kamalshahr' },
      { name: 'نظرآباد', slug: 'nazarabad' },
      { name: 'محمدشهر', slug: 'mohammadshahr-alborz' },
      { name: 'هشتگرد', slug: 'hashtgerd' },
      { name: 'ماهدشت', slug: 'mahdasht' },
    ],
  },
  {
    name: 'ایلام',
    slug: 'ostan-ilam',
    cities: [
      { name: 'ایلام', slug: 'ilam' },
      { name: 'ایوان', slug: 'ivan' },
      { name: 'دهلران', slug: 'dehloran' },
      { name: 'آبدانان', slug: 'abdanan' },
      { name: 'مهران', slug: 'mehran' },
    ],
  },
  {
    name: 'بوشهر',
    slug: 'ostan-bushehr',
    cities: [
      { name: 'بوشهر', slug: 'bushehr' },
      { name: 'برازجان', slug: 'borazjan' },
      { name: 'بندر کنگان', slug: 'bandar-kangan' },
      { name: 'بندر گناوه', slug: 'bandar-ganaveh' },
      { name: 'خورموج', slug: 'khormoj' },
      { name: 'جم', slug: 'jam' },
      { name: 'عسلویه', slug: 'asaluyeh' },
    ],
  },
  {
    name: 'تهران',
    slug: 'ostan-tehran',
    cities: [
      { name: 'تهران', slug: 'tehran' },
      { name: 'اسلامشهر', slug: 'eslamshahr' },
      { name: 'شهریار', slug: 'shahriar' },
      { name: 'قدس', slug: 'qods' },
      { name: 'ملارد', slug: 'malard' },
      { name: 'گلستان', slug: 'golestan-tehran' },
      { name: 'ورامین', slug: 'varamin' },
      { name: 'قرچک', slug: 'qarchak' },
      { name: 'پاکدشت', slug: 'pakdasht' },
      { name: 'پردیس', slug: 'pardis' },
    ],
  },
  {
    name: 'چهارمحال و بختیاری',
    slug: 'ostan-chaharmahal-bakhtiari',
    cities: [
      { name: 'شهرکرد', slug: 'shahrekord' },
      { name: 'بروجن', slug: 'borujen' },
      { name: 'لردگان', slug: 'lordegan' },
      { name: 'فرخ‌شهر', slug: 'farrokhshahr' },
      { name: 'فارسان', slug: 'farsan' },
    ],
  },
  {
    name: 'خراسان جنوبی',
    slug: 'ostan-south-khorasan',
    cities: [
      { name: 'بیرجند', slug: 'birjand' },
      { name: 'قائنات', slug: 'ghayenat' },
      { name: 'طبس', slug: 'tabas' },
      { name: 'فردوس', slug: 'ferdows' },
      { name: 'نهبندان', slug: 'nehbandan' },
    ],
  },
  {
    name: 'خراسان رضوی',
    slug: 'ostan-razavi-khorasan',
    cities: [
      { name: 'مشهد', slug: 'mashhad' },
      { name: 'نیشابور', slug: 'neyshabur' },
      { name: 'سبزوار', slug: 'sabzevar' },
      { name: 'تربت حیدریه', slug: 'torbat-heydariyeh' },
      { name: 'قوچان', slug: 'quchan' },
      { name: 'کاشمر', slug: 'kashmar' },
      { name: 'تایباد', slug: 'taybad' },
      { name: 'چناران', slug: 'chenaran' },
    ],
  },
  {
    name: 'خراسان شمالی',
    slug: 'ostan-north-khorasan',
    cities: [
      { name: 'بجنورد', slug: 'bojnurd' },
      { name: 'شیروان', slug: 'shirvan' },
      { name: 'اسفراین', slug: 'esfarayen' },
      { name: 'آشخانه', slug: 'ashkhaneh' },
      { name: 'گرمه', slug: 'garmeh' },
    ],
  },
  {
    name: 'خوزستان',
    slug: 'ostan-khuzestan',
    cities: [
      { name: 'اهواز', slug: 'ahvaz' },
      { name: 'دزفول', slug: 'dezful' },
      { name: 'آبادان', slug: 'abadan' },
      { name: 'بندر ماهشهر', slug: 'bandar-mahshahr' },
      { name: 'خرمشهر', slug: 'khorramshahr' },
      { name: 'اندیمشک', slug: 'andimeshk' },
      { name: 'ایذه', slug: 'izeh' },
      { name: 'بهبهان', slug: 'behbahan' },
      { name: 'شوشتر', slug: 'shushtar' },
    ],
  },
  {
    name: 'زنجان',
    slug: 'ostan-zanjan',
    cities: [
      { name: 'زنجان', slug: 'zanjan' },
      { name: 'ابهر', slug: 'abhar' },
      { name: 'خرمدره', slug: 'khorramdarreh' },
      { name: 'قیدار', slug: 'qeydar' },
      { name: 'هیدج', slug: 'hidaj' },
    ],
  },
  {
    name: 'سمنان',
    slug: 'ostan-semnan',
    cities: [
      { name: 'سمنان', slug: 'semnan' },
      { name: 'شاهرود', slug: 'shahrud' },
      { name: 'دامغان', slug: 'damghan' },
      { name: 'گرمسار', slug: 'garmsar' },
      { name: 'مهدی‌شهر', slug: 'mahdishahr' },
    ],
  },
  {
    name: 'سیستان و بلوچستان',
    slug: 'ostan-sistan-baluchestan',
    cities: [
      { name: 'زاهدان', slug: 'zahedan' },
      { name: 'زابل', slug: 'zabol' },
      { name: 'ایرانشهر', slug: 'iranshahr' },
      { name: 'چابهار', slug: 'chabahar' },
      { name: 'سراوان', slug: 'saravan' },
      { name: 'خاش', slug: 'khash' },
    ],
  },
  {
    name: 'فارس',
    slug: 'ostan-fars',
    cities: [
      { name: 'شیراز', slug: 'shiraz' },
      { name: 'مرودشت', slug: 'marvdasht' },
      { name: 'جهرم', slug: 'jahrom' },
      { name: 'فسا', slug: 'fasa' },
      { name: 'کازرون', slug: 'kazerun' },
      { name: 'صدرا', slug: 'sadra' },
      { name: 'داراب', slug: 'darab' },
      { name: 'فیروزآباد', slug: 'firuzabad' },
      { name: 'لار', slug: 'lar' },
    ],
  },
  {
    name: 'قزوین',
    slug: 'ostan-qazvin',
    cities: [
      { name: 'قزوین', slug: 'qazvin' },
      { name: 'الوند', slug: 'alvand' },
      { name: 'اقبالیه', slug: 'eqbaliyeh' },
      { name: 'تاکستان', slug: 'takestan' },
      { name: 'آبیک', slug: 'abyek' },
      { name: 'محمدیه', slug: 'mohammadiyeh' },
    ],
  },
  {
    name: 'قم',
    slug: 'ostan-qom',
    cities: [
      { name: 'قم', slug: 'qom' },
      { name: 'قنوات', slug: 'qanavat' },
      { name: 'جعفریه', slug: 'jafariyeh' },
      { name: 'کهک', slug: 'kahak' },
    ],
  },
  {
    name: 'کردستان',
    slug: 'ostan-kurdistan',
    cities: [
      { name: 'سنندج', slug: 'sanandaj' },
      { name: 'سقز', slug: 'saqqez' },
      { name: 'مریوان', slug: 'marivan' },
      { name: 'بانه', slug: 'baneh' },
      { name: 'قروه', slug: 'qorveh' },
      { name: 'کامیاران', slug: 'kamyaran' },
      { name: 'بیجار', slug: 'bijar' },
    ],
  },
  {
    name: 'کرمان',
    slug: 'ostan-kerman',
    cities: [
      { name: 'کرمان', slug: 'kerman' },
      { name: 'سیرجان', slug: 'sirjan' },
      { name: 'رفسنجان', slug: 'rafsanjan' },
      { name: 'جیرفت', slug: 'jiroft' },
      { name: 'بم', slug: 'bam' },
      { name: 'زرند', slug: 'zarand' },
      { name: 'کهنوج', slug: 'kahnuj' },
    ],
  },
  {
    name: 'کرمانشاه',
    slug: 'ostan-kermanshah',
    cities: [
      { name: 'کرمانشاه', slug: 'kermanshah' },
      { name: 'اسلام‌آباد غرب', slug: 'eslamabad-gharb' },
      { name: 'جوانرود', slug: 'javanrud' },
      { name: 'کنگاور', slug: 'kangavar' },
      { name: 'سرپل ذهاب', slug: 'sarpol-zahab' },
      { name: 'سنقر', slug: 'sonqor' },
    ],
  },
  {
    name: 'کهگیلویه و بویراحمد',
    slug: 'ostan-kohgiluyeh-boyerahmad',
    cities: [
      { name: 'یاسوج', slug: 'yasuj' },
      { name: 'دوگنبدان', slug: 'dogonbadan' },
      { name: 'دهدشت', slug: 'dehdasht' },
      { name: 'لیکک', slug: 'likak' },
      { name: 'چرام', slug: 'charam' },
    ],
  },
  {
    name: 'گلستان',
    slug: 'ostan-golestan',
    cities: [
      { name: 'گرگان', slug: 'gorgan' },
      { name: 'گنبد کاووس', slug: 'gonbad-kavus' },
      { name: 'بندر ترکمن', slug: 'bandar-torkaman' },
      { name: 'علی‌آباد کتول', slug: 'aliabad-katul' },
      { name: 'آزادشهر', slug: 'azadshahr' },
      { name: 'کردکوی', slug: 'kordkuy' },
    ],
  },
  {
    name: 'گیلان',
    slug: 'ostan-gilan',
    cities: [
      { name: 'رشت', slug: 'rasht' },
      { name: 'بندر انزلی', slug: 'bandar-anzali' },
      { name: 'لاهیجان', slug: 'lahijan' },
      { name: 'لنگرود', slug: 'langarud' },
      { name: 'هشتپر', slug: 'hashtpar' },
      { name: 'آستارا', slug: 'astara' },
      { name: 'صومعه‌سرا', slug: 'someesara' },
      { name: 'رودسر', slug: 'rudsar' },
    ],
  },
  {
    name: 'لرستان',
    slug: 'ostan-lorestan',
    cities: [
      { name: 'خرم‌آباد', slug: 'khorramabad' },
      { name: 'بروجرد', slug: 'borujerd' },
      { name: 'دورود', slug: 'dorud' },
      { name: 'کوهدشت', slug: 'kuhdasht' },
      { name: 'الیگودرز', slug: 'aligudarz' },
      { name: 'نورآباد', slug: 'nurabad-lorestan' },
      { name: 'ازنا', slug: 'azna' },
    ],
  },
  {
    name: 'مازندران',
    slug: 'ostan-mazandaran',
    cities: [
      { name: 'ساری', slug: 'sari' },
      { name: 'بابل', slug: 'babol' },
      { name: 'آمل', slug: 'amol' },
      { name: 'قائم‌شهر', slug: 'qaemshahr' },
      { name: 'بهشهر', slug: 'behshahr' },
      { name: 'چالوس', slug: 'chalus' },
      { name: 'نکا', slug: 'neka' },
      { name: 'بابلسر', slug: 'babolsar' },
      { name: 'تنکابن', slug: 'tonekabon' },
    ],
  },
  {
    name: 'مرکزی',
    slug: 'ostan-markazi',
    cities: [
      { name: 'اراک', slug: 'arak' },
      { name: 'ساوه', slug: 'saveh' },
      { name: 'خمین', slug: 'khomein' },
      { name: 'محلات', slug: 'mahallat' },
      { name: 'دلیجان', slug: 'delijan' },
      { name: 'شازند', slug: 'shazand' },
    ],
  },
  {
    name: 'هرمزگان',
    slug: 'ostan-hormozgan',
    cities: [
      { name: 'بندرعباس', slug: 'bandar-abbas' },
      { name: 'میناب', slug: 'minab' },
      { name: 'دهبارز', slug: 'dehbarez' },
      { name: 'قشم', slug: 'qeshm' },
      { name: 'کیش', slug: 'kish' },
      { name: 'بندر لنگه', slug: 'bandar-lengeh' },
      { name: 'حاجی‌آباد', slug: 'hajjiabad' },
    ],
  },
  {
    name: 'همدان',
    slug: 'ostan-hamedan',
    cities: [
      { name: 'همدان', slug: 'hamedan' },
      { name: 'ملایر', slug: 'malayer' },
      { name: 'نهاوند', slug: 'nahavand' },
      { name: 'اسدآباد', slug: 'asadabad' },
      { name: 'تویسرکان', slug: 'tuyserkan' },
      { name: 'بهار', slug: 'bahar' },
    ],
  },
  {
    name: 'یزد',
    slug: 'ostan-yazd',
    cities: [
      { name: 'یزد', slug: 'yazd' },
      { name: 'میبد', slug: 'meybod' },
      { name: 'اردکان', slug: 'ardakan' },
      { name: 'بافق', slug: 'bafq' },
      { name: 'مهریز', slug: 'mehriz' },
      { name: 'ابرکوه', slug: 'abarkuh' },
    ],
  },
];

/** همه اسلاگ‌ها باید یکتا باشند */
export function collectIranLocationSlugs(): string[] {
  const slugs: string[] = [];
  for (const p of IRAN_LOCATION_SEED) {
    slugs.push(p.slug);
    for (const c of p.cities) slugs.push(c.slug);
  }
  return slugs;
}
