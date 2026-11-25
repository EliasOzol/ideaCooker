# RecipeRemix

> "I only have 300 g of chicken, not 500 g." Find a recipe, scale it to what you actually have, and keep your own version.

**Daily idea · 2026-04-03**

Code: <https://github.com/EliasOzol/recipeRemix>

## The idea

RecipeRemix turns recipes from food sites into editable copies that you own.

1. **Search** for a dish or ingredient and pick from a list of recipes from different sites.
2. **Scale** it by number of servings, or by **one ingredient**: tell it you have 300 g chicken and every other amount follows.
3. **Remix** it: edit amounts, units, ingredients and steps, and add your own notes.
4. **Favourite** it, so your version is saved, with a link back to the original.

## Why

- Recipes assume you shop for them. In practice you cook with what's already in the fridge.
- Doing the conversion by hand for every ingredient is slow and easy to get wrong.
- Recipe sites are full of ads and life stories. A clean, editable copy is much nicer to cook from.
- Your tweaks ("less salt", "double the garlic") usually get lost. A favourite keeps them next to the recipe.

## The prototype

A React 19 + Vite app in [`min-mad-app/`](https://github.com/EliasOzol/recipeRemix/tree/main/min-mad-app). Almost everything (search, parser, scaling, UI and CSS) is in one file: [`min-mad-app/src/App.jsx`](https://github.com/EliasOzol/recipeRemix/blob/main/min-mad-app/src/App.jsx). The UI is in Danish and follows the system's light or dark mode.

It has three tabs:

- **Søg:** a single search field at the top. It queries the free [TheMealDB](https://www.themealdb.com/api.php) API by dish name and by main ingredient, and lists up to 40 recipes with picture, original site (BBC Good Food, Simply Recipes, AllRecipes …), category and cuisine. Search terms must be in English. Click a row to open it, or the heart to save it. The old link and pasted-text import sits in a fold-out below.
- **Remix:** scale by **Personer** or **Ingrediens**, and edit title, ingredients, steps and notes inline. Ingredients without a number ("salt og peber", "Zest of 1 Orange") are not scaled.
- **Favoritter:** saved recipes in `localStorage`. While a recipe is a favourite, every edit is saved to it automatically.

No tests. `npm run lint` and `npm run build` both pass.

### Run it

```powershell
git clone https://github.com/EliasOzol/recipeRemix.git
cd recipeRemix\min-mad-app
npm install
npm run dev        # Vite prints the local URL, usually http://localhost:5173
```

Search needs internet access. Link import also depends on public CORS proxies being up.

## Status

🟡 **Prototype.** You can search, open, scale, edit and favourite recipes, but search only covers TheMealDB's English catalogue and every recipe starts at 4 servings.

## Next steps

- [ ] Add Danish sources (Valdemarsro, Arla) to search; their APIs aren't public, so this needs a small backend
- [ ] Detect servings instead of always assuming 4
- [ ] "Reset to original" button in Remix, and show what you changed
- [ ] Round to kitchen-friendly amounts (1.5 løg → "1½ løg", 0.33 tsk → "a pinch")
- [ ] Convert units (cups → dl, oz → g) for English recipes
- [ ] Add tests for `parseIngredient`, `mealToRecipe` and the scaling functions
- [ ] Use a small backend or serverless function for link import, instead of public CORS proxies
- [ ] Sync favourites between devices
