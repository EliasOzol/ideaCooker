# 🧠⏰ BrainReminder

> Not good at taking breaks? Let BrainReminder take care of that ;)

**Daily idea · 2026-11-25**

## The idea

BrainReminder is a break alarm that won't let you hide behind "just five more minutes".
Every so often it goes off with a small physical challenge:

- do 5 squats
- drink a glass of water
- do 2 burpees
- stretch for 30 seconds
- walk around for a minute

You can **snooze** for 5 or 10 minutes, but snoozing isn't free: the challenge **accrues interest**.
Snooze a "5 squats" challenge for 10 minutes and it comes back as 8. Snooze again and the interest compounds.
Paying off your break debt early is always cheaper.

## Why

- Short movement breaks keep your brain sharp and help with focus.
- Stepping away is often what gets you unstuck on a hard problem.
- Regular breaks help prevent burnout.
- The interest mechanic turns procrastinating on your break into a small, funny cost you can see.

## The prototype

A single-file web app: [`index.html`](index.html). Open it in a browser, no install or build step needed.

Features:

- Choose a break interval (e.g. every 25, 45 or 60 minutes; a 10-second demo mode is there for testing)
- An alarm sound (Web Audio) plus a browser notification, if you allow notifications
- A random challenge from a list you can edit
- **Snooze 5 min**: +25% interest · **Snooze 10 min**: +60% interest (compounding, always at least +1)
- "Done!" logs the break and keeps a daily streak of completed breaks and total reps
- Settings and stats are saved in `localStorage`

### Run it

```powershell
start index.html
```

## Status

🟡 **Prototype.** It works in the browser, but it isn't a real desktop app with tray or background alarms yet.

## Next steps

- [ ] Run as a tray app (Tauri or Electron) so it works when the browser is closed
- [ ] Pause automatically during meetings (calendar integration)
- [ ] "Bankruptcy" mode: past a certain debt, you have to do a big break
- [ ] Stats page with weekly charts
- [ ] Physical version: an ESP32 with a buzzer and a big snooze button on your desk
