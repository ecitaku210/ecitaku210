# TripSplit

A Splitwise-style expense splitter for group trips. It installs on any phone
from a browser, works with no signal, and needs no server, no account and no
sign-up.

---

## What it does

- Log an expense in about five seconds: amount, what for, who paid, who shares it
- Split **equally**, by **exact amounts**, by **shares** (a couple counts as 2), or by **percentage**
- See at a glance who is up and who is down
- **Settle up**: nets everyone off into the fewest payments instead of everyone paying everyone
- Swap updates with the group by sharing a file or a code — over WhatsApp, AirDrop, email, anything

---

## The one thing you must understand before using it

There is no server. **Each phone only knows what that phone typed** until you sync.

If you log dinner and your friend logs the taxi, your balance screen is wrong
until one of you shares. That is not a bug, it is the direct cost of having no
backend — and it is the trade you accept in exchange for no accounts, no
hosting bill and no company holding your group's spending history.

**Sync every evening, not just at the end of the trip.** It takes one tap, and
sending the same update twice is completely harmless (see below).

---

## How the sync actually works

The interesting part of this app is not the expense form, it is the merge.

Every record — expense, person, repayment — carries four fields:

| Field | Purpose |
| --- | --- |
| `id` | A UUID minted on the phone that created it. Two phones can never mint the same one. |
| `updatedAt` | When it was last edited. |
| `updatedBy` | Which phone edited it. Used **only** to break `updatedAt` ties. |
| `deletedAt` | A *tombstone*. Deleted records are marked, never removed. |

Merging two ledgers is then a set union, taking the newer version of anything
that appears in both. This structure is a **CRDT** (Conflict-free Replicated
Data Type) — specifically an **LWW-Element-Set** — and it has three properties
that the test suite verifies against randomly generated, deliberately divergent
ledgers:

- **Commutative** — `merge(A, B) == merge(B, A)`. Order of imports does not matter.
- **Associative** — `merge(merge(A, B), C) == merge(A, merge(B, C))`. Grouping does not matter.
- **Idempotent** — `merge(A, A) == A`. Importing the same file ten times changes nothing.

Those three together mean everyone can send everyone their file, in any order,
as often as they like, and every phone converges on the same answer. That is
what makes "just send it in the group chat" a safe protocol instead of a mess.

**Why tombstones?** If deleting an expense actually removed the record, then
merging with a friend whose copy still had it would silently bring it back.
A tombstone is a record that says "this is gone, as of this moment", so the
deletion wins over any older version of the row.

### What the merge cannot fix

If you and your friend each separately type in the same ₹2,000 dinner, those
are two different records with two different ids. No algorithm can know they
are the same meal — they are indistinguishable from two genuinely identical
bills. The app flags them (same date, same amount, same payer, entered on
different phones) and leaves the decision to you. It never deletes anything on
its own.

---

## Why money is stored as integers

Every amount is held as a whole number of **minor units** — paise, cents, fils.
`₹12.35` is stored as `1235`.

Floating point cannot represent `0.1` exactly, so `0.1 + 0.2 !== 0.3` in every
mainstream language, JavaScript included. On a personal budget that is a
rounding curiosity. On a shared ledger it is an argument about who owes an
extra paisa. Integers make the arithmetic exact.

The same care applies to splitting. `₹100` three ways is not `₹33.33` each —
that loses a paisa. The app uses the **largest remainder method**: everyone
gets their floored share, then the leftover units go one at a time to whoever
was rounded down hardest, with ties broken on member id so **every phone
computes byte-identical shares**. The result always sums to exactly the amount
of the expense. That invariant is asserted over thousands of random cases.

---

## Settling up

Turning balances into payments uses a greedy largest-debtor-to-largest-creditor
pass. With six people, paying each other back pairwise is 15 transfers; netting
first brings that down to at most 5.

Honest caveat: this is not guaranteed to be the theoretical *minimum* number of
transfers — that problem is NP-hard. Greedy is optimal unless some subgroup
happens to net exactly to zero, and is never worse than `n-1`.

---

## Getting it onto everyone's phone

**Service workers require HTTPS**, so the app must be served over TLS for the
install to work. `localhost` is exempt, which is why local development works.

1. Push to `main`. The included GitHub Actions workflow builds and publishes to
   GitHub Pages.
2. In the repository, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Share the resulting `https://<user>.github.io/<repo>/` link with the group.
4. Each person opens it and taps:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** menu → *Install app* / *Add to Home screen*

It then launches full-screen with its own icon, with no browser chrome, and
opens instantly with no signal.

Any static host works equally well — Netlify, Vercel, Cloudflare Pages. Build
with `BASE_PATH=/` when serving from a domain root.

---

## Running it locally

```bash
npm install
npm run dev        # dev server
npm test           # the domain test suite
npm run build      # production build into dist/
npm run preview    # serve the built app
npm run icons      # regenerate the PWA icons
```

To try it on your actual phone, run `npm run dev -- --host` and open the LAN
address it prints. Note that the service worker will not register over plain
http, so the app will run but will not be installable — deploy it for that.

---

## Where things live

```
src/
  domain/          no React, no browser APIs — pure, and fully tested
    types.ts       the data model and the replication contract
    money.ts       parsing and formatting of minor units
    split.ts       dividing an expense (largest remainder)
    balance.ts     who has paid what, who owes what
    settle.ts      balances -> a short list of payments
    merge.ts       the CRDT: merging two phones' ledgers
    ledger.ts      import/export, and validation of untrusted files
  storage/
    db.ts          localStorage persistence, quota handling
    store.tsx      React state; every mutation stamps the LWW fields
  ui/              screens and components
```

The `domain/` folder deliberately has no dependency on React or the DOM. That
is what lets the arithmetic and the merge be tested exhaustively, and it is
where a future server-backed version would plug in unchanged.

---

## Known limits

These are deliberate, not oversights:

- **One currency per trip.** Convert before entering. Multi-currency needs
  per-expense FX rates and a rate source, which is a real feature, not a flag.
- **One payer per expense.** If two people split a bill at the till, log two
  expenses. Keeping this single-valued keeps the balance maths honest.
- **Data lives in this browser's storage.** Uninstalling the PWA or clearing
  site data deletes it. Export regularly — that is also your backup.
- **Removing someone does not rewrite history.** Their past shares stay on the
  books, because recalculating them would change what everyone else owes.
- **No photos or trip journal.** Text only, which keeps a whole trip under a
  few hundred KB and comfortably inside the storage budget.
