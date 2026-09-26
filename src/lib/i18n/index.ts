// InvoiceFlow — Multi-language Support (i18n)
// Provides localized interface terms for major Indian languages:
// English, Hindi (हिन्दी), Marathi (मराठी), Gujarati (ગુજરાતી),
// Tamil (தமிழ்), Telugu (తెలుగు), Bengali (বাংলা), Kannada (ಕನ್ನಡ),
// Malayalam (മലയാളം), Punjabi (ਪੰਜਾਬੀ).

import { useEffect, useState } from 'react'
import { setSetting } from '@/lib/db/repositories'
import { useAppSetting } from '@/lib/hooks/app-hooks'

export interface LanguageOption {
  code: string
  name: string
  nativeName: string
  region: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', region: 'Global / India' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', region: 'India (National)' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', region: 'Maharashtra' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', region: 'Gujarat' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', region: 'Tamil Nadu' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', region: 'Andhra / Telangana' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', region: 'West Bengal' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', region: 'Karnataka' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', region: 'Kerala' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', region: 'Punjab' },
]

export const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.reports': 'Reports',
    'nav.invoices': 'Invoices',
    'nav.quotations': 'Quotations',
    'nav.payments': 'Payments',
    'nav.customers': 'Customers',
    'nav.products': 'Products & Services',
    'nav.company': 'My Company',
    'nav.settings': 'Settings',

    'group.overview': 'Overview',
    'group.sales': 'Sales',
    'group.manage': 'Manage',
    'group.system': 'System',

    'settings.title': 'Settings',
    'settings.preferences': 'Preferences',
    'settings.appearance': 'Appearance',
    'settings.appearance_desc': 'Choose how InvoiceFlow looks on this device. The preference is saved instantly.',
    'settings.language': 'Language',
    'settings.language_desc': 'Choose your preferred language for the interface and billing workflows.',
    'settings.app_device': 'App & device',
    'settings.app_device_desc': 'Installation details used for sync bookkeeping and support.',
    'settings.sync': 'Sync',
    'settings.data': 'Data & Backup',
    'settings.security': 'Security',

    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.search': 'Search products, customers, invoices…',
    'action.new_invoice': 'New invoice',
    'action.new_quotation': 'New quotation',
    'action.add_customer': 'Add customer',
    'action.add_product': 'Add product',
  },
  hi: {
    'nav.dashboard': 'डैशबोर्ड',
    'nav.reports': 'रिपोर्ट्स',
    'nav.invoices': 'इनवॉइस / बिल',
    'nav.quotations': 'कोटेशन / अनुमान',
    'nav.payments': 'भुगतान / पेमेंट्स',
    'nav.customers': 'ग्राहक',
    'nav.products': 'उत्पाद एवं सेवाएं',
    'nav.company': 'मेरी कंपनी',
    'nav.settings': 'सेटिंग्स',

    'group.overview': 'अवलोकन',
    'group.sales': 'बिक्री',
    'group.manage': 'प्रबंधन',
    'group.system': 'सिस्टम',

    'settings.title': 'सेटिंग्स',
    'settings.preferences': 'प्राथमिकताएं',
    'settings.appearance': 'दिखावट (थीम)',
    'settings.appearance_desc': 'चुनें कि इस डिवाइस पर InvoiceFlow कैसा दिखे। प्राथमिकता तुरंत सहेजी जाती है।',
    'settings.language': 'भाषा चुनें (Language)',
    'settings.language_desc': 'इंटरफ़ेस और बिलिंग कार्यप्रवाह के लिए अपनी पसंदीदा भाषा चुनें।',
    'settings.app_device': 'ऐप और डिवाइस',
    'settings.app_device_desc': 'सिंक और सहायता के लिए उपयोग किए जाने वाले इंस्टॉलेशन विवरण।',
    'settings.sync': 'सिंक',
    'settings.data': 'डेटा और बैकअप',
    'settings.security': 'सुरक्षा',

    'action.save': 'सहेजें',
    'action.cancel': 'रद्द करें',
    'action.search': 'उत्पाद, ग्राहक, इनवॉइस खोजें…',
    'action.new_invoice': 'नया इनवॉइस',
    'action.new_quotation': 'नया कोटेशन',
    'action.add_customer': 'ग्राहक जोड़ें',
    'action.add_product': 'उत्पाद जोड़ें',
  },
  mr: {
    'nav.dashboard': 'डॅशबोर्ड',
    'nav.reports': 'अहवाल (Reports)',
    'nav.invoices': 'पावत्या / इनव्हॉइस',
    'nav.quotations': 'कोटेशन / अंदाज',
    'nav.payments': 'पेमेंट्स (देयके)',
    'nav.customers': 'ग्राहक',
    'nav.products': 'उत्पादने व सेवा',
    'nav.company': 'माझी कंपनी',
    'nav.settings': 'सेटिंग्ज',

    'group.overview': 'आढावा',
    'group.sales': 'विक्री',
    'group.manage': 'व्यवस्थापन',
    'group.system': 'सिस्टम',

    'settings.title': 'सेटिंग्ज',
    'settings.preferences': 'प्राधान्ये',
    'settings.appearance': 'देखावा (थीम)',
    'settings.appearance_desc': 'या डिव्हाइसवर InvoiceFlow कसा दिसावा ते निवडा. बदल लगेच लागू होतात.',
    'settings.language': 'भाषा निवडा (Language)',
    'settings.language_desc': 'इंटरफेस आणि बिलिंगसाठी आपली पसंतीची भाषा निवडा.',
    'settings.app_device': 'अॅप आणि डिव्हाइस',
    'settings.app_device_desc': 'सिंक आणि सपोर्टसाठी वापरले जाणारे तपशील.',
    'settings.sync': 'सिंक',
    'settings.data': 'डेटा आणि बॅकअप',
    'settings.security': 'सुरक्षा',

    'action.save': 'जतन करा',
    'action.cancel': 'रद्द करा',
    'action.search': 'उत्पादने, ग्राहक, इनव्हॉइस शोधा…',
    'action.new_invoice': 'नवीन इनव्हॉइस',
    'action.new_quotation': 'नवीन कोटेशन',
    'action.add_customer': 'ग्राहक जोडा',
    'action.add_product': 'उत्पादन जोडा',
  },
  gu: {
    'nav.dashboard': 'ડેશબોર્ડ',
    'nav.reports': 'અહેવાલો (Reports)',
    'nav.invoices': 'ઇન્વોઇસ / બિલ',
    'nav.quotations': 'કોટિશન / અંદાજ',
    'nav.payments': 'ચુકવણીઓ (Payments)',
    'nav.customers': 'ગ્રાહકો',
    'nav.products': 'પ્રોડક્ટ્સ અને સેવાઓ',
    'nav.company': 'મારી કંપની',
    'nav.settings': 'સેટિંગ્સ',

    'group.overview': 'ઝાંખી',
    'group.sales': 'વેચાણ',
    'group.manage': 'સંચાલન',
    'group.system': 'સિસ્ટમ',

    'settings.title': 'સેટિંગ્સ',
    'settings.preferences': 'પસંદગીઓ',
    'settings.appearance': 'દેખાવ (થીમ)',
    'settings.appearance_desc': 'આ ઉપકરણ પર InvoiceFlow કેવું દેખાય તે પસંદ કરો. પ્રાધાન્ય તરત જ સાચવવામાં આવે છે.',
    'settings.language': 'ભાષા પસંદ કરો (Language)',
    'settings.language_desc': 'ઇન્ટરફેસ અને બિલિંગ વર્કફ્લો માટે તમારી પસંદગીની ભાષા પસંદ કરો.',
    'settings.app_device': 'એપ્લિકેશન અને ઉપકરણ',
    'settings.app_device_desc': 'સિંક અને સપોર્ટ માટે વિગતો.',
    'settings.sync': 'સિંક',
    'settings.data': 'ડેટા અને બેકઅપ',
    'settings.security': 'સુરક્ષા',

    'action.save': 'સાચવો',
    'action.cancel': 'રદ કરો',
    'action.search': 'પ્રોડક્ટ્સ, ગ્રાહકો, ઇન્વોઇસ શોધો…',
    'action.new_invoice': 'નવું ઇન્વોઇસ',
    'action.new_quotation': 'નવું કોટિશન',
    'action.add_customer': 'ગ્રાહક ઉમેરો',
    'action.add_product': 'પ્રોડક્ટ ઉમેરો',
  },
  ta: {
    'nav.dashboard': 'டாஷ்போர்டு',
    'nav.reports': 'அறிக்கைகள்',
    'nav.invoices': 'விலைப்பட்டியல்கள்',
    'nav.quotations': 'மதிப்பீடுகள்',
    'nav.payments': 'பணப்பரிவர்த்தனைகள்',
    'nav.customers': 'வாடிக்கையாளர்கள்',
    'nav.products': 'தயாரிப்புகள் & சேவைகள்',
    'nav.company': 'எனது நிறுவனம்',
    'nav.settings': 'அமைப்புகள்',
    'group.overview': 'மேலோட்டம்',
    'group.sales': 'விற்பனை',
    'group.manage': 'நிர்வகித்தல்',
    'group.system': 'அமைப்பு',
    'settings.title': 'அமைப்புகள்',
    'settings.preferences': 'விருப்பங்கள்',
    'settings.appearance': 'தோற்றம்',
    'settings.appearance_desc': 'இந்த சாதனத்தில் பயன்பாடு எவ்வாறு காட்சியளிக்க வேண்டும் என்பதைத் தேர்ந்தெடுக்கவும்.',
    'settings.language': 'மொழியைத் தேர்ந்தெடுக்கவும் (Language)',
    'settings.language_desc': 'பயன்பாட்டு இடைமுகத்திற்கான மொழியைத் தேர்ந்தெடுக்கவும்.',
    'settings.app_device': 'செயலி & சாதனம்',
    'settings.app_device_desc': 'சாதன விவரங்கள்.',
    'settings.sync': 'ஒத்திசைவு',
    'settings.data': 'தரவு & காப்புப்பிரதி',
    'settings.security': 'பாதுகாப்பு',
    'action.save': 'சேமிக்க',
    'action.cancel': 'ரத்துசெய்',
    'action.search': 'தேடுங்கள்…',
    'action.new_invoice': 'புதிய விலைப்பட்டியல்',
    'action.new_quotation': 'புதிய மதிப்பீடு',
    'action.add_customer': 'வாடிக்கையாளரைச் சேர்',
    'action.add_product': 'தயாரிப்பைச் சேர்',
  },
  te: {
    'nav.dashboard': 'డాష్‌బోర్డ్',
    'nav.reports': 'నివేదికలు',
    'nav.invoices': 'ఇన్‌వాయిస్‌లు',
    'nav.quotations': 'కొటేషన్లు',
    'nav.payments': 'చెల్లింపులు',
    'nav.customers': 'కస్టమర్లు',
    'nav.products': 'ఉత్పత్తులు & సేవలు',
    'nav.company': 'నా కంపెనీ',
    'nav.settings': 'సెట్టింగ్‌లు',
    'group.overview': 'అవలోకనం',
    'group.sales': 'అమ్మకాలు',
    'group.manage': 'నిర్వహణ',
    'group.system': 'సిస్టమ్',
    'settings.title': 'సెట్టింగ్‌లు',
    'settings.preferences': 'ప్రాధాన్యతలు',
    'settings.appearance': 'రూపం (థీమ్)',
    'settings.appearance_desc': 'ఈ పరికరంలో అప్లికేషన్ ఎలా కనిపించాలో ఎంచుకోండి.',
    'settings.language': 'భాషను ఎంచుకోండి (Language)',
    'settings.language_desc': 'మీకు కావలసిన భాషను ఎంచుకోండి.',
    'settings.app_device': 'యాప్ & పరికరం',
    'settings.app_device_desc': 'పరికర వివరాలు.',
    'settings.sync': 'సింక్',
    'settings.data': 'డేటా & బ్యాకప్',
    'settings.security': 'భద్రత',
    'action.save': 'భద్రపరచు',
    'action.cancel': 'రద్దు చేయి',
    'action.search': 'శోధించండి…',
    'action.new_invoice': 'కొత్త ఇన్‌వాయిస్',
    'action.new_quotation': 'కొత్త కొటేషన్',
    'action.add_customer': 'కస్టమర్‌ను జోడించండి',
    'action.add_product': 'ఉత్పత్తిని జోడించండి',
  },
  bn: {
    'nav.dashboard': 'ড্যাশবোর্ড',
    'nav.reports': 'প্রতিবেদন',
    'nav.invoices': 'চালান (Invoices)',
    'nav.quotations': 'কোটেশন',
    'nav.payments': 'পেমেন্ট',
    'nav.customers': 'গ্রাহক',
    'nav.products': 'পণ্য ও পরিষেবা',
    'nav.company': 'আমার কোম্পানি',
    'nav.settings': 'সেটিংস',
    'group.overview': 'সংক্ষিপ্ত বিবরণ',
    'group.sales': 'বিক্রয়',
    'group.manage': 'পরিচালনা',
    'group.system': 'সিস্টেম',
    'settings.title': 'সেটিংস',
    'settings.preferences': 'পছন্দসমূহ',
    'settings.appearance': 'চেহারা (Theme)',
    'settings.appearance_desc': 'ইন্টারফেসের চেহারা নির্বাচন করুন।',
    'settings.language': 'ভাষা নির্বাচন করুন (Language)',
    'settings.language_desc': 'ইন্টারফেসের জন্য আপনার পছন্দের ভাষা নির্বাচন করুন।',
    'settings.app_device': 'অ্যাপ ও ডিভাইস',
    'settings.app_device_desc': 'ইনস্টলেশন বিবরণ।',
    'settings.sync': 'সিঙ্ক',
    'settings.data': 'ডেটা ও ব্যাকআপ',
    'settings.security': 'নিরাপত্তা',
    'action.save': 'সংরক্ষণ',
    'action.cancel': 'বাতিল',
    'action.search': 'অনুসন্ধান করুন…',
    'action.new_invoice': 'নতুন চালান',
    'action.new_quotation': 'নতুন কোটেশন',
    'action.add_customer': 'গ্রাহক যোগ করুন',
    'action.add_product': 'পণ্য যোগ করুন',
  },
  kn: {
    'nav.dashboard': 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    'nav.reports': 'ವರದಿಗಳು',
    'nav.invoices': 'ಇನ್‌ವಾಯ್ಸ್‌ಗಳು',
    'nav.quotations': 'ಕೊಟೇಶನ್‌ಗಳು',
    'nav.payments': 'ಪಾವತಿಗಳು',
    'nav.customers': 'ಗ್ರಾಹಕರು',
    'nav.products': 'ಉತ್ಪನ್ನಗಳು & ಸೇವೆಗಳು',
    'nav.company': 'ನನ್ನ ಕಂಪನಿ',
    'nav.settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    'group.overview': 'ಅವಲೋಕನ',
    'group.sales': 'ಮಾರಾಟ',
    'group.manage': 'ನಿರ್ವಹಣೆ',
    'group.system': 'ವ್ಯವಸ್ಥೆ',
    'settings.title': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    'settings.preferences': 'ಆದ್ಯತೆಗಳು',
    'settings.appearance': 'ಗೋಚರತೆ',
    'settings.appearance_desc': 'ಅಪ್ಲಿಕೇಶನ್ ಗೋಚರತೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    'settings.language': 'ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ (Language)',
    'settings.language_desc': 'ನಿಮ್ಮ ಆದ್ಯತೆಯ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    'settings.app_device': 'ಅಪ್ಲಿಕೇಶನ್ & ಸಾಧನ',
    'settings.app_device_desc': 'ಸಾಧನದ ವಿವರಗಳು.',
    'settings.sync': 'ಸಿಂಕ್',
    'settings.data': 'ಡೇಟಾ & ಬ್ಯಾಕಪ್',
    'settings.security': 'ಭದ್ರತೆ',
    'action.save': 'ಉಳಿಸಿ',
    'action.cancel': 'ರದ್ದುಮಾಡಿ',
    'action.search': 'ಹುಡುಕಿ…',
    'action.new_invoice': 'ಹೊಸ ಇನ್‌ವಾಯ್ಸ್',
    'action.new_quotation': 'ಹೊಸ ಕೊಟೇಶನ್',
    'action.add_customer': 'ಗ್ರಾಹಕರನ್ನು ಸೇರಿಸಿ',
    'action.add_product': 'ಉತ್ಪನ್ನವನ್ನು ಸೇರಿಸಿ',
  },
  ml: {
    'nav.dashboard': 'ഡാഷ്‌ബോർഡ്',
    'nav.reports': 'റിപ്പോർട്ടുകൾ',
    'nav.invoices': 'ഇൻവോയ്സുകൾ',
    'nav.quotations': 'കൊട്ടേഷനുകൾ',
    'nav.payments': 'പേയ്‌മെന്റുകൾ',
    'nav.customers': 'ഉപഭോക്താക്കൾ',
    'nav.products': 'ഉൽപ്പന്നങ്ങളും സേവനങ്ങളും',
    'nav.company': 'എന്റെ കമ്പനി',
    'nav.settings': 'ക്രമീകരണങ്ങൾ',
    'group.overview': 'അവലോകനം',
    'group.sales': 'വിൽപ്പന',
    'group.manage': 'മാനേജ് ചെയ്യുക',
    'group.system': 'സിസ്റ്റം',
    'settings.title': 'ക്രമീകരണങ്ങൾ',
    'settings.preferences': 'മുൻഗണനകൾ',
    'settings.appearance': 'രൂപം (Theme)',
    'settings.appearance_desc': 'ഇന്റർഫേസിന്റെ രൂപം തിരഞ്ഞെടുക്കുക.',
    'settings.language': 'ഭാഷ തിരഞ്ഞെടുക്കുക (Language)',
    'settings.language_desc': 'നിങ്ങളുടെ ഇഷ്ടപ്പെട്ട ഭാഷ തിരഞ്ഞെടുക്കുക.',
    'settings.app_device': 'ആപ്പും ഉപകരണവും',
    'settings.app_device_desc': 'ഉപകരണ വിവരങ്ങൾ.',
    'settings.sync': 'സിങ്ക്',
    'settings.data': 'ഡാറ്റയും ബാക്കപ്പും',
    'settings.security': 'സുരക്ഷ',
    'action.save': 'സംരക്ഷിക്കുക',
    'action.cancel': 'റദ്ദാക്കുക',
    'action.search': 'തിരയുക…',
    'action.new_invoice': 'പുതിയ ഇൻവോയ്സ്',
    'action.new_quotation': 'പുതിയ കൊട്ടേഷൻ',
    'action.add_customer': 'ഉപഭോക്താവിനെ ചേർക്കുക',
    'action.add_product': 'ഉൽപ്പന്നം ചേർക്കുക',
  },
  pa: {
    'nav.dashboard': 'ਡੈਸ਼ਬੋਰਡ',
    'nav.reports': 'ਰਿਪੋਰਟਾਂ',
    'nav.invoices': 'ਇਨਵੌਇਸ / ਬਿੱਲ',
    'nav.quotations': 'ਕੋਟੇਸ਼ਨ / ਅੰਦਾਜ਼ਾ',
    'nav.payments': 'ਭੁਗਤਾਨ',
    'nav.customers': 'ਗਾਹਕ',
    'nav.products': 'ਉਤਪਾਦ ਅਤੇ ਸੇਵਾਵਾਂ',
    'nav.company': 'ਮੇਰੀ ਕੰਪਨੀ',
    'nav.settings': 'ਸੈਟਿੰਗਾਂ',
    'group.overview': 'ਸੰਖੇਪ ਜਾਣਕਾਰੀ',
    'group.sales': 'ਵਿਕਰੀ',
    'group.manage': 'ਪ੍ਰਬੰਧਨ',
    'group.system': 'ਸਿਸਟਮ',
    'settings.title': 'ਸੈਟਿੰਗਾਂ',
    'settings.preferences': 'ਤਰਜੀਹਾਂ',
    'settings.appearance': 'ਦਿੱਖ (Theme)',
    'settings.appearance_desc': 'ਇੰਟਰਫੇਸ ਦੀ ਦਿੱਖ ਚੁਣੋ।',
    'settings.language': 'ਭਾਸ਼ਾ ਚੁਣੋ (Language)',
    'settings.language_desc': 'ਇੰਟਰਫੇਸ ਲਈ ਆਪਣੀ ਪਸੰਦੀਦਾ ਭਾਸ਼ਾ ਚੁਣੋ।',
    'settings.app_device': 'ਐਪ ਅਤੇ ਡਿਵਾਈਸ',
    'settings.app_device_desc': 'ਡਿਵਾਈਸ ਦੇ ਵੇਰਵੇ।',
    'settings.sync': 'ਸਿੰਕ',
    'settings.data': 'ਡੇਟਾ ਅਤੇ ਬੈਕਅੱਪ',
    'settings.security': 'ਸੁਰੱਖਿਆ',
    'action.save': 'ਸੰਭਾਲੋ',
    'action.cancel': 'ਰੱਦ ਕਰੋ',
    'action.search': 'ਖੋਜ ਕਰੋ…',
    'action.new_invoice': 'ਨਵਾਂ ਇਨਵੌਇਸ',
    'action.new_quotation': 'ਨਵਾਂ ਕੋਟੇਸ਼ਨ',
    'action.add_customer': 'ਗਾਹਕ ਸ਼ਾਮਲ ਕਰੋ',
    'action.add_product': 'ਉਤਪਾਦ ਸ਼ਾਮਲ ਕਰੋ',
  },
}

const LANGUAGE_STORAGE_KEY = 'invoiceflow_app_language'
const LANG_CHANGE_EVENT = 'invoiceflow_lang_changed'

export function getStoredLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'en'
  } catch {
    return 'en'
  }
}

export function setAppLanguage(code: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
    window.dispatchEvent(new CustomEvent(LANG_CHANGE_EVENT, { detail: code }))
    void setSetting('app_language', code).catch(() => undefined)
  } catch (e) {
    console.warn('[i18n] Failed to persist language:', e)
  }
}

/** React hook for accessing and changing active interface language */
export function useLanguage() {
  const dbLang = useAppSetting('app_language')
  const [lang, setLangState] = useState<string>(() => getStoredLanguage())

  useEffect(() => {
    if (dbLang && dbLang !== lang && TRANSLATIONS[dbLang]) {
      setLangState(dbLang)
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, dbLang)
      } catch {}
    }
  }, [dbLang, lang])

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      if (customEvent.detail && TRANSLATIONS[customEvent.detail]) {
        setLangState(customEvent.detail)
      }
    }
    window.addEventListener(LANG_CHANGE_EVENT, handleEvent)
    return () => window.removeEventListener(LANG_CHANGE_EVENT, handleEvent)
  }, [])

  const changeLanguage = (code: string) => {
    if (TRANSLATIONS[code]) {
      setLangState(code)
      setAppLanguage(code)
    }
  }

  const t = (key: string, fallback?: string): string => {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en
    if (dict && dict[key]) return dict[key]
    if (TRANSLATIONS.en[key]) return TRANSLATIONS.en[key]
    return fallback || key
  }

  return {
    lang,
    setLang: changeLanguage,
    t,
    languages: SUPPORTED_LANGUAGES,
    currentLanguage: SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0],
  }
}
