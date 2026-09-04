/**
 * VROZEK AI — interface localization (en / bn / hi / ur).
 * The AI itself replies in the caller's language via Gemini; this covers the
 * bot's own buttons and notices (CAPTCHA, moderation, reports, access).
 */

export type Lang = 'en' | 'bn' | 'hi' | 'ur';

export const LANGS: Lang[] = ['en', 'bn', 'hi', 'ur'];

export function langName(l: string): string {
  return { en: 'English', bn: 'বাংলা', hi: 'हिन्दी', ur: 'اردو' }[l] || 'English';
}

const D: Record<string, Record<Lang, string>> = {
  captcha_title: {
    en: '🧩 {name}, please verify you\'re human:',
    bn: '🧩 {name}, অনুগ্রহ করে যাচাই করুন যে আপনি মানুষ:',
    hi: '🧩 {name}, कृपया सत्यापित करें कि आप इंसान हैं:',
    ur: '🧩 {name}، براہ کرم تصدیق کریں کہ آپ انسان ہیں:',
  },
  captcha_btn: {
    en: '✅ I am human',
    bn: '✅ আমি মানুষ',
    hi: '✅ मैं इंसान हूँ',
    ur: '✅ میں انسان ہوں',
  },
  verified: {
    en: '✅ {name} verified. Welcome!',
    bn: '✅ {name} সফলভাবে যাচাই হয়েছে। স্বাগতম!',
    hi: '✅ {name} सत्यापित हुए। स्वागत है!',
    ur: '✅ {name} کی تصدیق ہوگئی۔ خوش آمدید!',
  },
  muted_flood: {
    en: '🔇 {name} muted for flooding.',
    bn: '🔇 {name} ফ্লাডিংয়ের জন্য মিউট করা হয়েছে।',
    hi: '🔇 {name} को स्पैम के लिए म्यूट किया गया।',
    ur: '🔇 {name} کو فلڈنگ پر خاموش کیا گیا۔',
  },
  strikes_reached: {
    en: '⚠️ {name} reached {n} strikes — muted for 1 hour.',
    bn: '⚠️ {name} {n} বার সতর্ক হলে ১ ঘণ্টার জন্য মিউট করা হলো।',
    hi: '⚠️ {name} को {n} स्ट्राइक — 1 घंटे के लिए म्यूट।',
    ur: '⚠️ {name} کو {n} اسٹرائیک — 1 گھنٹے کیلئے خاموش۔',
  },
  strike_deleted: {
    en: '⚠️ Removed a message ({cat}). {name} — strike {s}/{limit}.',
    bn: '⚠️ একটি বার্তা সরানো হয়েছে ({cat})। {name} — সতর্কতা {s}/{limit}।',
    hi: '⚠️ एक संदेश हटाया गया ({cat})। {name} — स्ट्राइक {s}/{limit}।',
    ur: '⚠️ ایک پیغام ہٹایا گیا ({cat})۔ {name} — اسٹرائیک {s}/{limit}۔',
  },
  report_confirm: {
    en: '📨 Thanks — the report was sent to the team.',
    bn: '📨 ধন্যবাদ — রিপোর্ট পাঠানো হয়েছে।',
    hi: '📨 धन्यवाद — रिपोर्ट भेज दी गई।',
    ur: '📨 شکریہ — رپورٹ بھیج دی گئی۔',
  },
  access_denied: {
    en: '🔒 This bot is privately managed. Please contact the administrator for access.',
    bn: '🔒 এই বটটি ব্যক্তিগতভাবে পরিচালিত। অ্যাক্সেসের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।',
    hi: '🔒 यह बॉट निजी रूप से प्रबंधित है। एक्सेस के लिए एडमिन से संपर्क करें।',
    ur: '🔒 یہ بوٹ نجی طور پر چلتا ہے۔ رسائی کے لیے ایڈمن سے رابطہ کریں۔',
  },
  welcome_default: {
    en: 'Welcome, {name}! 👋 We\'re happy to have you here.',
    bn: 'স্বাগতম, {name}! 👋 আপনাকে পেয়ে আমরা খুশি।',
    hi: 'स्वागत है, {name}! 👋 आपको पाकर हमें खुशी है।',
    ur: 'خوش آمدید، {name}! 👋 آپ کو پا کر ہمیں خوشی ہے۔',
  },
  goodbye_default: {
    en: '{name} has left the group. Take care! 👋',
    bn: '{name} গ্রুপ ছেড়েছেন। ভালো থাকুন! 👋',
    hi: '{name} ने ग्रुप छोड़ दिया। ध्यान रखें! 👋',
    ur: '{name} گروپ چھوڑ گئے۔ خیال رکھیں! 👋',
  },
};

export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const l: Lang = (LANGS as string[]).includes(lang) ? (lang as Lang) : 'en';
  let s = D[key]?.[l] ?? D[key]?.['en'] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
