# Food Manager

A small, phone-friendly web app for running a household's food: a weekly menu, a shopping
list built from it, the recipes worth making again, and a light-touch way to see what needs
eating before it goes bad.

It is plain HTML, CSS and JavaScript with no build step and no server. Data is stored in the
browser on the device you use it on.

## The weekly routine

Pick one planning time each week (for example, Saturday morning) and work down the four steps
on the Home screen. It takes about 15 minutes.

1. **Kitchen check** — walk to every place food is kept (by default the main fridge, the
   garage fridge and the storage room; edit the list in Settings). In each one, add what needs
   using up, note spares stored there, and tick the place off. The Menu and Home screens keep
   reminding you until every place is checked. Then tap the staples you are low on.
2. **Plan the menu** — pick a meal for each night. Recipes that use up what is already in the
   fridge are listed first. Leave a *leftovers night* and a *flex night* so a changed plan
   does not turn into wasted food.
3. **Build the shopping list** — ingredients are scaled to the servings you planned, merged,
   and grouped by store section. Stocked staples and food already in any location are left off,
   with a note saying where the spare is (for example, "spare in the Garage fridge").
4. **Shop** — check items off in the store and tap *Finish shopping*. Fresh food you bought is
   added to the Kitchen "use up" list automatically.

During the week:

- **Home** shows tonight's meal and anything getting old.
- When plans change, tap **Not tonight** / **Move** to swap two nights instead of dropping a meal.
- After cooking, tap **Cooked**. The app asks whether you would make it again, whether the
  amount was right (it adjusts the servings it plans next time), and how many portions of
  leftovers you saved.
- Tap **Tossed** when something is thrown out. The monthly count on Home is your scoreboard.

## Running it

Open `index.html` through any static web server, for example:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. To use it on your phones, host the folder anywhere that
serves static files (GitHub Pages works: Settings → Pages → deploy from the `main` branch),
open the address, and use "Add to Home Screen".

## Data and backups

Everything is saved in the browser's local storage on that one device; it does not sync
between phones. Use **Settings → Export backup** to save a file, and **Import backup** to load
it on another device. The shopping list can be sent to someone with **Share / copy**.
