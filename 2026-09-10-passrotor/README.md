# 🔐⚙️ Passrotor

> One master password, a different password for every site, and each one changes after you log in, like an Enigma rotor.

**Daily idea · 2026-09-10**

Code: <https://github.com/EliasOzol/Passrotor>

## The idea

Passrotor is a planned browser extension for **deterministic, per-site passwords that change over time**.

You always type the same master password. The extension works out the real password for each site from it:

```
derived_password = KDF(master_password, site_domain, rotation_counter)
```

Tools like LessPass and SuperGenPass already do `(master password, domain) → password`, but each site keeps the same password forever. Passrotor adds a small **rotation counter** per site. It moves forward after each successful login, so the site's password changes while your master password stays the same.

Nothing secret is stored. Only `{domain: counter}` pairs are saved, and the master password stays in memory only while a password is being derived.

The catch: unlike TOTP, the website has no rotor of its own. Before the counter can move forward, the extension has to go through the site's own change-password form and set the new password there.

## Why

- A leaked password goes stale: the next rotation gives that site a different password.
- There's no password vault to steal or sync, just one small integer per site.
- You still only have to remember one password.
- It's a fun crypto/UX experiment: how far can a stateless password manager go with only a little state?

## The prototype

So far the repository has the core logic as plain Node/Web Crypto modules, all in the repo root. There's no extension code yet:

- [`kdf.js`](https://github.com/EliasOzol/Passrotor/blob/main/kdf.js): derives the key with PBKDF2-SHA256 (250,000 iterations, salt `domain:counter`). `normalizeDomain` strips the protocol, `www.`, the path and uppercase letters. `formatAsPassword` turns the key into a 20-character password that always has a lowercase letter, an uppercase letter, a digit and a symbol.
- [`rotation-store.js`](https://github.com/EliasOzol/Passrotor/blob/main/rotation-store.js): an in-memory `RotationStore` with `get`, `increment` and JSON save/load for the per-site counters. The plan is to move it to `chrome.storage.sync` later.
- [`kdf.test.js`](https://github.com/EliasOzol/Passrotor/blob/main/kdf.test.js): plain-assert tests for determinism, rotation, per-site output, domain normalization and the password policy.

The README sketches the planned extension layout (Manifest V3, a content script that fills password fields, a login detector, a popup), but none of that is built yet.

### Run it

You need Node 19 or newer (for the global `crypto.subtle`). To derive a password straight from a clone:

```powershell
git clone https://github.com/EliasOzol/Passrotor.git
cd Passrotor
node -e "const { derivePassword } = require('./kdf.js'); derivePassword('my master password', 'https://www.example.com/login', 0).then(console.log)"
```

Change the last argument (`0` → `1`) to see the password rotate.

The tests (`node kdf.test.js`) **fail as committed**: they `require("../extension/background/kdf.js")`, which doesn't exist in the repository. See Next steps.

## Status

🔴 **Idea.** There's only a small derivation library with no extension around it, and its test suite can't run because the import path is wrong.

## Next steps

- [ ] **Fix the README:** it still has merge-conflict markers (`<<<<<<< HEAD` / `=======` / `>>>>>>>`). Keep the full RotoPass write-up, rename it to Passrotor and delete the markers.
- [ ] **Fix the test import:** `kdf.test.js` requires `../extension/background/kdf.js`. Change it to `./kdf.js`, or move the files into the planned `extension/` and `tests/` layout.
- [ ] Add a `package.json` with an `npm test` script
- [ ] Normalize domains in `RotationStore` too, so `www.example.com` and `example.com` share one counter like they do in `kdf.js`
- [ ] Hand-test the riskiest part first: can a site's change-password flow be automated (2FA, CAPTCHAs, re-entering the current password)?
- [ ] Prototype login-success detection on its own
- [ ] Build the Manifest V3 extension: popup, content script that fills fields, background derivation
- [ ] Sync counters across devices (`chrome.storage.sync`) and add drift recovery (try counters N-2 … N+2)
- [ ] Never move the counter forward until the site confirms the password change, so a failed change can't lock you out
- [ ] Per-site password policies (maximum length, allowed symbols). Today the formatter only uses 32 key bytes, so passwords longer than 32 characters repeat bytes.
