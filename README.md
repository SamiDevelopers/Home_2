# نظام إعداد خدام - دليل التشغيل

## المتطلبات

- مشروع Firebase باسم `khodam-2027`.
- Firebase CLI.
- Node.js 20 لإدارة Cloud Functions.

## إعداد Firebase

1. فعّل Authentication باستخدام مزود البريد الإلكتروني/كلمة المرور.
2. أنشئ قاعدة Firestore ونوعها Native Mode.
3. فعّل Firebase Storage وHosting.
4. من جذر المشروع نفّذ:

```bash
firebase login
firebase use khodam-2027
cd functions
npm install
cd ..
firebase deploy
```

إعداد Web App في [script.js](script.js) مطابق لمشروع `khodam-2027`.

## إنشاء أول مسؤول

1. افتح Firebase Console وانتقل إلى Authentication وأنشئ حساب المسؤول.
2. من Firebase Console أدخل إلى IAM وانتقل للحساب الذي يساوي حساب تسجيل دخول Firebase CLI أو صاحب المشروع.
3. امنحه دور **Owner** أو على الأقل:
   - `Firebase Admin SDK Administrator Service Agent`
   - `Firebase Authentication Admin`
   - `Cloud Functions Admin`
   - `Service Usage Consumer`
4. نفّذ `firebase login` بالحساب الذي له صلاحية المشروع، ثم تحقق من ظهوره:

```bash
firebase projects:list
firebase use khodam-2027
```

5. تأكد أن ملف Service Account يقع خارج المشروع، ثم نفّذ:

```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\secure\khodam-admin.json
node functions\set-admin.js admin@example.com
```

يعني `Could not load the default credentials` أن السكربت بدأ دون مفتاح
Service Account صالح؛ هذا الخطأ ليس في شاشة تسجيل الدخول ولا يمكن إصلاحه
بتغيير كلمة المرور. يجب أن ينتمي المفتاح إلى مشروع `khodam-2027` وأن تكون
حسابات الخدمة مرخصة للوصول إليه.

بعد التنفيذ يخرج المستخدم ويُسجل الدخول مجددًا حتى يحصل على `Custom Claims` المحدثة.

## نشر الواجهة

```bash
firebase deploy --only hosting,firestore:rules,storage:rules,firestore:indexes,functions
```

## النسخ الاحتياطي والاستيراد

- استخدم Firestore Export مجدولًا قبل التحديثات الأكاديمية الكبرى.
- لا تُحذف السجلات المعتمدة؛ نفّذ التصحيحات عبر سجل تاريخي وسبب موثق.
- يجب تتبع عمليات الاستيراد في مجموعة `importJobs` ومنع إعادة استيراد نفس الكود.
- استعد النسخ عبر المشروع نفسه أو مشروع استعادة منفصل ثم راجع الفهارس وقواعد الأمان قبل إعادة الربط.

## الأمان والصلاحيات

- الأدوار الحالية هي `student` و`servant` و`control` و`admin` و`priest`.
- جميع العمليات الحساسة تتم عبر Cloud Functions.
- لا تعتمد واجهة المتصفح وحدها كحماية؛ تعتمد قاعدة البيانات على Firestore Security Rules وClaims.
- رفض الوصول الافتراضي مطبق على الوثائق غير المعرفة صراحةً.
