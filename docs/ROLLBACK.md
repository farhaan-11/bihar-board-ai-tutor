# ROLLBACK.md — site toot gayi, ab kya karein

> **Kab padhna hai:** jab `main` pe kuch deploy hua aur uske baad Zuno toot gaya —
> students ko error aa raha hai, page blank hai, ya jawab nahi aa raha.
>
> **Golden rule:** pehle site theek karo, bug baad mein dhoondho.
> Emergency mein naya code likh ke "fix" mat karo — pichla working version wapas chalao.
>
> Stage 1 checklist item **G3** (`STAGE1_DONE.md`). Written 2026-10-27.

---

## Zuno kahan chalta hai

| Hissa | Kahan | `main` pe push hone pe |
|---|---|---|
| Backend | Render (web service, root `backend/`) | Khud deploy hota hai |
| Frontend | Vercel (root `frontend/`) | Khud deploy hota hai |
| Python retriever | Render (alag service, repo `zuno-retrieval-service`) | Us repo ke push pe deploy hota hai |
| Database | MongoDB Atlas | Deploy se kuch nahi badalta |
| EC2 | Band hai | `deploy-ec2.yml` chalta hai par SSH pe fail hota hai — ignore karo |

---

## Step 0 — Pehle 2 minute: kya toota?

1. Backend zinda hai? Browser mein backend ka `/health` kholo.
   - `200` aaya → backend chal raha hai. Problem frontend mein ya kisi ek feature mein hai.
   - Error / timeout → backend toota hai.
   - ⚠️ Render free tier 15 minute idle ke baad so jaata hai. Pehli request ~50 second le sakti hai. **Ek baar 1 minute ruk ke dobara try karo** — tabhi "toota" maano.
2. Pichla deploy kab hua tha? GitHub → repo → commits on `main`. Sabse upar wala commit hi shayad wajah hai.
3. Render dashboard → backend service → **Logs**. Laal error lines dekho.

Ab neeche se sahi section chuno.

---

## A. Backend toota (Render)

**Hissa 1 — Turant (site 2–5 minute mein wapas):**

1. Render dashboard → backend service → **Events** (ya **Deploys**) tab.
2. Sabse naya deploy kharab wala hai. Uske neeche wala — jo pehle chal raha tha — dhoondho.
3. Us pe **Rollback** button dabao.
4. Deploy "Live" hone ka wait karo. `/health` dobara check karo.

**Hissa 2 — Pakka (warna agle push pe wahi bug wapas aayega):**

Render ka rollback sirf purana version chalata hai. Kharab code abhi bhi `main` pe hai —
agla push use dobara deploy kar dega. Isliye `main` se bhi hatao. Repo folder mein:

```bash
git switch main
git pull
git log --oneline -5
```

Kharab commit ka hash dekho. Agar woh ek **merge commit** hai (message "Merge: …"):

```bash
git revert -m 1 <merge-commit-hash>
```

Agar normal commit hai:

```bash
git revert <commit-hash>
```

Phir:

```bash
git push origin main
```

`git revert` kuch delete nahi karta — ek naya commit banata hai jo kharab badlav ko ulta kar
deta hai. History safe rehti hai. Bug baad mein ek nayi branch pe theek karo.

> ⚠️ Render pe auto-deploy chalu hai, toh `git revert` push karne se bhi purana
> version deploy ho jayega. Agar Rollback button na mile, sirf Hissa 2 karna bhi kaafi hai —
> bas thoda zyada time lagega (build + deploy).

---

## B. Frontend toota (Vercel)

**Hissa 1 — Turant:**

1. Vercel dashboard → project → **Deployments**.
2. Pichla deployment dhoondho jo theek chal raha tha (status "Ready").
3. Uske `⋯` menu mein **Promote to Production** (ya **Instant Rollback**) dabao.
4. Site ek minute mein purana version dikhayegi. Browser mein hard refresh karo (`Ctrl+Shift+R`).

**Hissa 2 — Pakka:** bilkul section A ka Hissa 2 — `git revert` + `git push origin main`.

---

## C. Env variable badla aur toota

Kabhi code nahi, **setting** badalne se cheez tootti hai (Render ya Vercel ke Environment page pe).

1. Wahi variable pichli value pe wapas karo.
2. Render env badalne pe khud redeploy karta hai. Vercel mein `VITE_*` variable badla hai
   toh **Redeploy** dabana padega — yeh build ke time pe frontend mein jud jaate hain.

Isliye: **koi bhi env variable badalne se pehle uski purani value kahin likh lo.**
(Secret values kabhi git mein ya chat mein nahi.)

---

## D. Python retriever ki wajah se dikkat

Backend ka env variable `USE_PYTHON_RETRIEVER` decide karta hai Python kitna use ho:

| Value | Matlab |
|---|---|
| `false` | Sirf Node. Python bilkul use nahi hota. |
| `shadow` | **Abhi production pe yahi hai.** Student ko jawab Node deta hai; Python peeche chalta hai, sirf log hota hai. Python fail ho toh students pe asar nahi. |
| `true` | Sirf Python. Python down = students ko error. |

Rollback: Render → backend service → Environment → `USE_PYTHON_RETRIEVER=false` → save.
Redeploy ke baad Python poori tarah bahar.

---

## E. Database — ⚠️ deploy rollback isse wapas NAHI karta

Render/Vercel rollback sirf **code** wapas karta hai. Agar kharab deploy ne database mein galat
data likh diya ya kuch delete kar diya, woh rollback se wapas nahi aayega.

- Data wapas laane ka ek hi raasta hai: **backup** (Stage 1 item G2).
- Isliye koi bhi migration / index script ya data badalne wala kaam **production pe chalane
  se pehle backup lo**.
- `chunks` (study content) aur `questions` (quiz bank) dobara ban sakte hain
  (`npm run rag:index`, quiz seed). Users, chats, progress, quiz attempts **nahi** — unka
  backup hi sahara hai.

---

## Rollback ke baad

1. `/health` aur site dono check karo — ek sawal poochh ke dekho.
2. `PROJECT_STATE.md` mein ek line likho: kya toota, kab, kaunsa commit revert hua.
3. Bug ko ek **nayi branch** pe theek karo — failing test → fix → passing test
   (`AUDIT_RULES.md`). Seedha `main` pe kabhi nahi.
