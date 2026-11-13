# Food Manager

A small, phone-friendly web app for running a household's food: a weekly menu, a shopping
list built from it, the recipes worth making again, and a light-touch way to see what needs
eating before it goes bad.

It is plain HTML, CSS and JavaScript with no build step. Each phone keeps its own copy of the
data, and optional family sharing keeps every phone in step through a free Firebase database.

## The weekly routine

Pick one planning time each week (for example, Saturday morning) and work down the four steps
on the Home screen. It takes about 15 minutes.

1. **Kitchen check** — walk to every place food is kept (by default the main fridge, the
   kitchen pantry, the garage fridge and the storage room; edit the list in Settings). In each one, add what needs
   using up, note spares stored there, and tick the place off. The Menu and Home screens keep
   reminding you until every place is checked.

   Staples are listed under the place they are kept, each with a **safety stock** number
   ("keep 1", "keep 6"). During the check, set the count of what is actually there with the
   − and + buttons. When the count is below the safety stock, the shopping list adds enough
   to get back to it. Tap a staple's name to change its safety stock or where it is kept.
   Example: add "Milk spare gallon" as a staple in the garage fridge with keep 1; when the
   spare is gone, the count is 0 and a gallon goes on the list.
2. **Plan the menu** — pick a meal for each night. Recipes that use up what is already in the
   fridge are listed first. Leave a *leftovers night* and a *flex night* so a changed plan
   does not turn into wasted food.
3. **Build the shopping list** — ingredients are scaled to the servings you planned, merged,
   and grouped by store section. Staples below their safety stock are added. Stocked staples
   and food already in any location are left off,
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

## Adding things quickly

- **Import from a link**: in Recipes tap *New*, then *Add from a link or pasted text*, and
  paste the address of a recipe page. This needs the one-time setup in "Turn on recipe link
  import" below.
- **Paste a recipe**: in the same box, paste the
  whole recipe text copied from a website, message or note instead; the app picks out the name,
  servings, ingredients, method and link for you to check before saving.
- **Add several items at once**: in the shopping list or a Kitchen place, type or dictate items
  with commas between them ("milk, eggs, 2 lb chicken"), or paste a list with one item per line.
- **One-tap repeats**: the items you type into the shopping list most often appear as buttons
  under the add box whenever they are not already on the list.

## Setting it up

### 1. Publish the app with GitHub Pages

1. Merge this code into the `main` branch.
2. On a free GitHub plan the repository must be public: **Settings → General → Danger Zone →
   Change visibility → Public**. Only the app's code is in the repository, never your data.
3. **Settings → Pages → Build and deployment**: set *Source* to "Deploy from a branch", choose
   `main` and `/ (root)`, and save.
4. After a minute the app is live at `https://<your-username>.github.io/<repository-name>/`.
   Open it on each phone and use "Add to Home Screen".

### 2. Turn on family sharing

1. Go to <https://console.firebase.google.com>, sign in with a Google account and create a
   project (Google Analytics is not needed).
2. In the project choose **Build → Realtime Database → Create database** and start in
   *locked mode*.
3. On the database's **Rules** tab, replace the rules with these and publish:

   ```json
   {
     "rules": {
       "households": {
         "$code": {
           ".read": "$code.length >= 20",
           ".write": "$code.length >= 20"
         }
       }
     }
   }
   ```

4. Copy the database address from the **Data** tab. It looks like
   `https://your-project-default-rtdb.firebaseio.com`.
5. In the app on one phone open **Settings**, paste the address under *Family sharing* and tap
   **Start sharing from this phone**. That phone's data becomes the household's data.
6. Open **Settings → Invite link**, send the link to each family member, and have them open
   it on their phone and tap **Join**.

The header shows **Shared** when a phone is in step and **Offline** when it is not. Changes made
offline are kept on the phone and combined with everyone else's when it reconnects.

The invite link is the key to your data: the household code inside it is long and random, and
anyone who has the link can read and change the household's food data. Share it only with
family.

### 3. Turn on recipe link import (optional)

A web page cannot read other websites directly, so link import uses a small free helper
service (a Cloudflare Worker) that you own. Its code is in `worker/recipe-import.js`.

1. Create a free account at <https://dash.cloudflare.com> and open **Workers & Pages**.
2. Create a new Worker (the "Hello World" starter is fine), name it `recipe-import`, and
   deploy it.
3. Choose **Edit code**, delete everything in the editor, paste in the whole contents of
   `worker/recipe-import.js`, and deploy again.
4. Copy the Worker's address. It looks like `https://recipe-import.your-name.workers.dev`.
5. In the app open **Settings**, paste the address into *Recipe link import address* and
   save. With family sharing on, every phone picks it up.

The Worker only answers requests coming from the app's own address, which is set in
`ALLOWED_ORIGINS` at the top of the file (`https://mhumphries72.github.io`). Change that line
if the app is ever hosted somewhere else.

Link import reads the recipe details most recipe sites publish for search engines. On a page
without them, or a site that blocks automated visits, the app says so; copy the recipe text
and paste it instead.

### Running it locally

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Data and backups

Use **Settings → Export backup** now and then to save a copy of everything to a file, and
**Import backup** to restore it. The shopping list can also be sent as text with
**Share / copy**.
