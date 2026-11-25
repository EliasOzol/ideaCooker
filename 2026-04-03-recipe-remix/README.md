# RecipeRemix

> "I only have 300 g of chicken, not 500 g." Import the recipe, scale it to what you actually have, and keep your own version.

**Daily idea · 2026-04-03**

Code: <https://github.com/EliasOzol/recipeRemix>

## The idea

RecipeRemix turns a recipe from a food blog into an editable copy that you own.

1. **Import** it from a URL, or paste the text when the site blocks automated imports.
2. **Scale** it by number of servings, or by **one ingredient**: tell it you have 300 g chicken and every other amount follows.
3. **Remix** it: edit amounts, units, ingredients and steps, and add your own notes.
4. **Fork** it into a personal library, with a link back to the original.

## Why

- Recipes assume you shop for them. In practice you cook with what's already in the fridge.
- Doing the conversion by hand for every ingredient is slow and easy to get wrong.
- Recipe sites are full of ads and life stories. A clean, editable copy is much nicer to cook from.
- Your tweaks ("less salt", "double the garlic") usually get lost. A fork keeps them next to the recipe.

## The prototype

A React 19 + Vite app in [`min-mad-app/`](https://github.com/EliasOzol/recipeRemix/tree/main/min-mad-app). Almost everything (parser, scaling, UI and CSS) is in one file: [`min-mad-app/src/App.jsx`](https://github.com/EliasOzol/recipeRemix/blob/main/min-mad-app/src/App.jsx). The UI is in Danish.

It has three tabs:

- **Import:** fetches the page through public CORS proxies (`api.allorigins.win`, then `corsproxy.io`) and reads the `schema.org/Recipe` JSON-LD, including Yoast `@graph` data and `HowToSection` steps. **Indsæt rå tekst** is a fallback that splits pasted text into ingredients and steps using headings such as "Ingredienser" and "Fremgangsmåde".
- **Canvas:** an ingredient parser that handles amounts like `1 1/2` and `1,5` and maps Danish and English units (`dl`, `spsk`, `tsk`, `fed`, `cup`, `tbsp`, `oz` …) onto one set of units. You can scale by **Personer** (servings) or by **Ingrediens** (a chosen ingredient and amount), and edit ingredients and steps inline. There is also a notes field.
- **Bibliotek:** recipes saved with **Fork & Gem**, which you can open again or delete.

No tests. `npm run build` passes, but `npm run lint` reports 4 errors (unused variables and an empty `catch`).

### Run it

```powershell
git clone https://github.com/EliasOzol/recipeRemix.git
cd recipeRemix\min-mad-app
npm install
npm run dev        # Vite prints the local URL, usually http://localhost:5173
```

URL import needs internet access and depends on the third-party proxies being up.

## Status

🟡 **Prototype.** Import, scaling and editing work, but the library is lost when you reload the page, and ingredients that start with a Unicode fraction (`½ tsk salt`) aren't parsed.

## Next steps

- [ ] **Fix:** the library is stored in `window.__rmxLib`, not `localStorage`, so forks are lost on reload
- [ ] **Fix:** `½`/`¼`/`¾` are replaced with a leading space, so the `^` regex doesn't match and `½ tsk salt` becomes "1 stk  0.5 tsk salt"
- [ ] **Fix:** the 4 lint errors, and remove the Vite template's `index.css` (dark background, `body` flex centering) that `main.jsx` still imports
- [ ] Don't scale "to taste" items such as `salt og peber`, which default to 1 stk and get multiplied
- [ ] Detect servings in pasted text instead of always assuming 4
- [ ] Round to kitchen-friendly amounts (1.5 løg → "1½ løg", 0.33 tsk → "a pinch")
- [ ] Convert units (cups → dl, oz → g) for English recipes
- [ ] Add tests for `parseIngredient`, `parseRawText` and the scaling functions
- [ ] Use a small backend or serverless function for fetching, instead of public CORS proxies
- [ ] Check the layout at phone width and in dark mode
