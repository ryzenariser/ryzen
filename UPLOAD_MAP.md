# 📁 COMPLETE FILE UPLOAD MAP

Copy this exact folder structure to your GitHub repo.

```
ryzen/  (your repo root)
│
├── 📄 index.html                          ← UPLOAD (updated storefront)
├── 📄 package.json                        ← UPLOAD (dependencies)
├── 📄 vite.config.js                      ← UPLOAD (Vite config)
├── 📄 tailwind.config.js                  ← UPLOAD (Tailwind config)
├── 📄 postcss.config.js                   ← UPLOAD (PostCSS config)
├── 📄 .gitignore                          ← UPLOAD (excludes .env.local)
├── 📄 .env.example                        ← UPLOAD (credential template)
├── 📄 QUICKSTART.md                       ← UPLOAD (5-step guide)
├── 📄 GITHUB_UPLOAD.md                    ← UPLOAD (this map)
├── 📄 SETUP.md                            ← UPLOAD (detailed setup)
├── 📄 README.md                           ← KEEP (your existing readme)
├── 📄 products.json                       ← KEEP (your product data)
│
├── 📄 supabase-schema.sql                 ← UPLOAD (run in Supabase SQL Editor)
├── 📄 storage-setup.sql                   ← UPLOAD (run in Supabase SQL Editor)
│
├── 📁 src/                                ← CREATE THIS FOLDER
│   ├── 📄 AuthFlow.jsx                    ← UPLOAD (full auth UI)
│   ├── 📄 supabaseClient.js               ← UPLOAD (Supabase init)
│   ├── 📄 App.jsx                         ← UPLOAD (React root)
│   ├── 📄 main.jsx                        ← UPLOAD (entry point)
│   └── 📄 index.css                       ← UPLOAD (Tailwind styles)
│
├── 📁 api/                                ← KEEP (your existing API)
│   ├── 📄 *.js                            ← KEEP (don't touch)
│   └── ...
│
├── 📁 supabase/                           ← CREATE THIS FOLDER
│   └── 📁 functions/                      ← CREATE THIS FOLDER
│       │
│       ├── 📁 create-membership-subscription/
│       │   └── 📄 index.ts                ← UPLOAD (from supabase-functions-create-membership-subscription.ts)
│       │
│       ├── 📁 razorpay-webhook/
│       │   └── 📄 index.ts                ← UPLOAD (from supabase-functions-razorpay-webhook.ts)
│       │
│       ├── 📁 cancel-membership/
│       │   └── 📄 index.ts                ← UPLOAD (from supabase-functions-cancel-membership.ts)
│       │
│       └── 📁 delete-account/
│           └── 📄 index.ts                ← UPLOAD (from supabase-functions-delete-account.ts)
│
└── ❌ .env.local                          ← DO NOT UPLOAD (in .gitignore)
```

---

## 📍 STEP-BY-STEP UPLOAD INSTRUCTIONS

### Step 1: Root Files (drag & drop into repo root)
```
From package → Upload to repo root
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
├── .env.example
├── QUICKSTART.md
├── GITHUB_UPLOAD.md
├── SETUP.md
├── supabase-schema.sql
└── storage-setup.sql
```

### Step 2: Create `src/` folder → Upload React files
```
New folder: src/
└── Upload these files inside:
    ├── AuthFlow.jsx
    ├── supabaseClient.js
    ├── App.jsx
    ├── main.jsx
    └── index.css
```

### Step 3: Create `supabase/functions/` folders → Upload Edge Functions

**Create 4 nested folders:**
```
New folder: supabase/functions/create-membership-subscription/
└── Create file: index.ts
└── Copy content from: supabase-functions-create-membership-subscription.ts

New folder: supabase/functions/razorpay-webhook/
└── Create file: index.ts
└── Copy content from: supabase-functions-razorpay-webhook.ts

New folder: supabase/functions/cancel-membership/
└── Create file: index.ts
└── Copy content from: supabase-functions-cancel-membership.ts

New folder: supabase/functions/delete-account/
└── Create file: index.ts
└── Copy content from: supabase-functions-delete-account.ts
```

---

## 🎯 QUICK REFERENCE

| Item | Location | Action |
|------|----------|--------|
| AuthFlow.jsx | `src/` | Upload |
| supabaseClient.js | `src/` | Upload |
| index.html | Root | Upload (replaces old one) |
| package.json | Root | Upload (replaces old one) |
| vite.config.js | Root | Upload (new file) |
| tailwind.config.js | Root | Upload (new file) |
| postcss.config.js | Root | Upload (new file) |
| supabase-schema.sql | Root | Upload (run in Supabase) |
| storage-setup.sql | Root | Upload (run in Supabase) |
| index.ts × 4 | `supabase/functions/*/` | Upload |
| .env.local | **DO NOT UPLOAD** | Create locally only |
| products.json | Root | KEEP (don't replace) |
| api/ folder | Root | KEEP (don't touch) |

---

## ✅ VERIFICATION CHECKLIST

After uploading, your GitHub repo should look like this:

```
✅ Root has: index.html, package.json, vite.config.js, tailwind.config.js, postcss.config.js, .gitignore, .env.example, *.md files, *.sql files

✅ src/ folder exists with: AuthFlow.jsx, supabaseClient.js, App.jsx, main.jsx, index.css

✅ supabase/functions/ has 4 subfolders:
   - create-membership-subscription/index.ts
   - razorpay-webhook/index.ts
   - cancel-membership/index.ts
   - delete-account/index.ts

✅ api/ folder still there (untouched)

✅ products.json still in root (untouched)

✅ .env.local is NOT in repo (it's in .gitignore)
```

---

## 🚀 AFTER UPLOADING

```bash
# Commit everything
git add .
git commit -m "Add Vite React auth with Supabase + Razorpay membership"
git push origin main

# Then follow QUICKSTART.md for Supabase/Razorpay setup
```

Done! ✨
