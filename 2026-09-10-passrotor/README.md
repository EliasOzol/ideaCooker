# 🔐⚙️ Passrotor

> One master password, a different password for every site, and each one changes when you rotate it, like an Enigma rotor.

**Daily idea · 2026-09-10**

Code: <https://github.com/EliasOzol/Passrotor>

## The idea

Passrotor is a browser extension for **deterministic, per-site passwords that change over time**.

You always type the same master password. The extension works out the real password for each site from it:

```
derived_password = KDF(master_password, site_domain, rotation_counter)
```

Tools like LessPass and SuperGenPass already do `(master password, domain) → password`, but each site keeps the same password forever. Passrotor adds a small **rotation counter** per site. When it moves forward, the site's password changes while your master password stays the same.

Nothing secret is stored. Only `{domain: counter}` pairs are saved, and the master password stays in memory only while the popup is open.

The catch: unlike TOTP, the website has no rotor of its own. Before the counter can move forward, the new password has to be set through the site's own change-password form.

## Why

- A leaked password goes stale: the next rotation gives that site a different password.
- There's no password vault to steal or sync, just one small integer per site.
- You still only have to remember one password.
- It's a fun crypto/UX experiment: how far can a stateless password manager go with only a little state?

## The prototype

[`docs/index.html`](https://github.com/EliasOzol/Passrotor/blob/main/docs/index.html) is a playground you can try without installing anything (it's what the Prototype tab shows). It runs the real `kdf.js` and `rotation-store.js` against a simulated website: sign up, log in, rotate in two steps, watch the old password get rejected, and fix drift with − / +.

The repository root is an unpacked Manifest V3 extension (Brave, Chrome, Edge):

- [`manifest.json`](https://github.com/EliasOzol/Passrotor/blob/main/manifest.json): permissions `activeTab`, `scripting` and `storage`, no background script.
- [`popup.html`](https://github.com/EliasOzol/Passrotor/blob/main/popup.html) / [`popup.js`](https://github.com/EliasOzol/Passrotor/blob/main/popup.js): picks up the site from the open tab, takes the master password, and offers **Fill login** (fills visible password fields, only if the site matches the tab), **Copy** and **Show**.
- **Two-step rotation:** *Rotate this site's password…* → *Fill change form* on the site's change-password page (current password → current field, next password → "new"/"confirm" fields) → submit → reopen and click *It worked*. Only then does the counter move forward; *Cancel* drops it. The rotation in progress survives the popup closing.
- **− / +** buttons step the counter by hand to fix drift.
- [`kdf.js`](https://github.com/EliasOzol/Passrotor/blob/main/kdf.js): PBKDF2-SHA256 (250,000 iterations, salt `domain:counter`), domain normalization and a 20-character password with lowercase, uppercase, digit and symbol.
- [`rotation-store.js`](https://github.com/EliasOzol/Passrotor/blob/main/rotation-store.js): per-site counters, now using the same domain normalization as `kdf.js`. The popup saves them to `chrome.storage.sync`.
- [`test-site/server.js`](https://github.com/EliasOzol/Passrotor/blob/main/test-site/server.js): a fake website with no dependencies (register, login, two change-password forms: one well labelled, one with meaningless field names). The account page shows the stored password, so you can see what Passrotor did without risking a real account. [`test-site/smoke.test.js`](https://github.com/EliasOzol/Passrotor/blob/main/test-site/smoke.test.js) starts it and runs the whole flow over HTTP with real derived passwords: register, log in, rotate twice, and check that the old password is rejected.
- Tests: [`kdf.test.js`](https://github.com/EliasOzol/Passrotor/blob/main/kdf.test.js) and [`rotation-store.test.js`](https://github.com/EliasOzol/Passrotor/blob/main/rotation-store.test.js), run with `npm test`.

### Run it

```powershell
git clone https://github.com/EliasOzol/Passrotor.git
cd Passrotor
npm test                      # Node 19+, includes the test-site smoke test
npm run test-site             # fake website on http://localhost:8080
```

In Brave, open `brave://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `Passrotor` folder. Then open <http://localhost:8080>. Register and log in with **Fill login**, then rotate on *Change password* with **Fill change form** → submit → **It worked**.

## Status

🟡 **Prototype.** The extension derives, fills, copies and rotates passwords with a manual confirm step, but rotation isn't automatic yet and it hasn't been tried on real sites yet.

## Next steps

- [x] A local test site to try the full register → login → rotate flow safely
- [x] An in-browser playground (`docs/index.html`) so the idea can be tried without the extension

- [x] Fix the README merge-conflict markers
- [x] Fix the test import and add `npm test`
- [x] Normalize domains in `RotationStore` too
- [x] Build the Manifest V3 extension: popup, fill, copy
- [x] Sync counters with `chrome.storage.sync` and never move the counter forward until you confirm the change worked
- [ ] Hand-test *Fill change form* on 2–3 real sites (2FA, CAPTCHAs, unusual field names)
- [ ] Login-success detection, so rotation can be offered or done automatically after a login
- [ ] Automatic drift recovery (try counters N-2 … N+2) instead of only the −/+ buttons
- [ ] Define what a "site" is: subdomains (`login.example.com` ≠ `example.com` today), `.co.uk`-style TLDs, site migrations
- [ ] Per-site password policies (maximum length, allowed symbols). The formatter only uses 32 key bytes, so passwords longer than 32 characters repeat bytes.
- [ ] Consider Argon2 instead of PBKDF2, and a Firefox build
- [ ] An icon
