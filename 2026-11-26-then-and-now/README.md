# Then & Now

> A diary for people who don't keep diaries: one short question a day, and every so often your past answers come back.

**Daily idea · 2026-11-26**

## Quick Start

1. Open `index.html` in a browser:

   ```powershell
   start index.html
   ```

2. Click **Load a sample year** at the bottom of the page.
3. Click **Skip to the next day** a few times to see memories and re-asked questions.

## Prerequisites

- A modern browser. There is no install, no build step and no network access; everything is in [`index.html`](index.html).

## Usage

Each day you get one simple question, such as "What made you smile today?". A sentence is enough (max 280 characters), so a daily answer takes about 30 seconds instead of a full diary entry. The payoff comes later, when older answers return:

- **Memories:** some days, a past answer appears above the new question. Answers from exactly 1 year, 6 months, 3 months, 1 month or 1 week ago come back on that day; otherwise there is a 50% chance of a random answer that is at least a week old.
- **Re-asked questions:** a question you last answered 21 or more days ago has a 40% chance of coming back. You answer it fresh first, then a timeline shows every answer you have given to it, so you can compare then and now.
- **Your answers:** a collapsible list of everything you have written, newest first.

Other details:

- The question pool has 32 questions. The day's question is picked with a seed based on the date and stored, so it doesn't change on reload.
- Answers are saved in `localStorage` with their date and question. **Edit** changes today's answer.
- Demo controls: **Load a sample year** replaces your data with 19 example answers spread over the past year. **Skip to the next day** moves the app's date forward, **Back to today** returns to the real date, and **Erase everything** clears all data.

## Configuration

These constants are at the top of the `<script>` block in `index.html`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REASK_AFTER_DAYS` | No | `21` | Days that must pass before a question can be asked again |
| `REASK_CHANCE` | No | `0.4` | Chance that a due question is re-asked instead of a new one |
| `RANDOM_MEMORY_CHANCE` | No | `0.5` | Chance of a random memory on days with no anniversary match |
| `ANNIVERSARIES` | No | 365, 182, 91, 30, 7 days | Exact intervals that bring back a past answer, with their labels |

## Status

🟡 **Prototype.** The daily question, memories and re-asking work in the browser, but data stays in one browser and there are no daily reminders.

## Next steps

- [ ] A daily notification or phone widget, so you don't have to remember to open it
- [ ] Export and import answers as JSON, so they survive a browser reset
- [ ] Let users add their own questions
- [ ] A yearly look back with your answers to the same question across the year
- [ ] Sync between phone and laptop
