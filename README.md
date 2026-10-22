# What's On Toowoomba

A free static calendar of events, garage sales, and community notices in Toowoomba, Queensland. The site is plain HTML, CSS, and JavaScript. It reads `data/events.json`. GitHub Pages can host it from this repository with no server and no paid hosting.

## How it works

1. `scripts/collect.mjs` fetches public listing pages that allow automated reads.
2. It normalises each listing, tags age group, community, and category with keyword rules, drops anything outside the Toowoomba region or already finished, and dedupes matches.
3. It writes `data/events.json` only when the listings changed. A source that errors keeps its previous listings. A source that is skipped or returns nothing contributes nothing new.
4. The page merges that file with approved rows in `data/submissions.json`. Past listings stay hidden.
5. `scripts/pages.mjs` then writes crawlable HTML: one page per event, category, and suburb, plus this weekend, this week, garage sales, search, `sitemap.xml`, `robots.txt`, RSS, Atom, and iCal. It refreshes the homepage head and the static listing HTML, and adds the same head and a crawlable place list to `things-to-do.html`. Place pages come from `data/things-to-do.json`. Run it on its own with `npm run pages`.
6. GitHub Actions runs the collector at 6:00 and 18:00 Australia/Brisbane (`0 20 * * *` and `0 8 * * *` UTC) and when someone starts the workflow by hand. The same run generates the pages above and commits them with `data/events.json` when something changed. The workflow uses the default `GITHUB_TOKEN` with `contents: write` only.

Visitor counts use [GoatCounter](https://www.goatcounter.com/): no cookies and no personal data. The site code is `whatsontoowoomba` in `scripts/analytics.mjs`, which is the only place to change it. Every page, including pages written by `scripts/pages.mjs`, includes the GoatCounter `count.js` snippet. Outbound clicks on event source links, share-form submits, report submits (`form.report-form`), and the things-to-do filters are sent as GoatCounter events.

`.github/workflows/visitor-stats.yml` runs every Monday at 03:17 UTC and when started by hand. If the `GOATCOUNTER_TOKEN` repository secret is missing, the job exits without writing or committing. With the secret set, it writes `data/stats/weekly.json` (top pages, referrers, search versus direct, top events, and totals against the previous week) and commits only when those counts change.

Canonical URLs use `https://whatsontoowoomba.au`. `CNAME` stays in the repo root. Homepage `<head>` has placeholder `google-site-verification` and `msvalidate.01` meta tags for Search Console and Bing Webmaster. Replace the tokens, or add the DNS TXT records those tools show, then submit `https://whatsontoowoomba.au/sitemap.xml`. Feeds: `/feed.xml`, `/atom.xml`, `/events.ics`.

Filters on the calendar:

- Age group: Kids 0-12, Teens 13-17, Young adults 18-30, Adults, Seniors 60+, Families/All ages
- Community: Indian, Filipino, African, Pacific Islander, Chinese, Korean, Latin American, Indigenous/First Nations, Multicultural/All
- Category: music, sport, church/faith, markets, arts, education, free events, garage sales
- Date: today, this weekend, this week, this month

Each card shows the title, date and time, venue, price or free, and a link back to the source. Garage sales have their own tab with date, suburb or address, and items.

If a run finds nothing upcoming, the page shows an empty state. The collector does not invent listings.

Run it locally with Node 22:

```bash
node scripts/collect.mjs
npm test
```

## Sources

| Source | What is read | What is skipped |
| --- | --- | --- |
| Toowoomba Regional Council | Public event pages under [Events and special days](https://www.tr.qld.gov.au/Places-and-activities/Things-to-see-and-do/Events-and-special-days) on tr.qld.gov.au. `robots.txt` allows those paths. Those pages are fetched with a browser user-agent and accept headers, and HTTP 403 or 409 is retried after a short backoff. | [Visit Toowoomba Region](https://visit.tr.qld.gov.au/) (`events.tr.qld.gov.au` redirects there) often blocks cloud networks before a listings page is returned. The run records that and continues. |
| Toowoomba Region Libraries | Dated sessions on council program pages, including [First 5 Forever](https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events/First-5-Forever-and-0-5-year-sessions). | The Spydus catalogue at `toowoomba.spydus.com` disallows all robots, so it is not fetched. |
| Eventbrite | The public Toowoomba destination page, up to four result pages: [all events](https://www.eventbrite.com.au/d/australia--toowoomba/all-events/). | `/api/v3/destination/events/` is disallowed by Eventbrite's `robots.txt` and is not requested. Online and out-of-region rows are dropped. |
| Humanitix | The public search page [Australia / Toowoomba](https://humanitix.com/au/search/australia/toowoomba). `robots.txt` allows it. | Rows whose address is outside the region, and cancelled listings. |
| Meetup | The public find page [au--toowoomba](https://www.meetup.com/find/au--toowoomba/). Event rows come from the embedded page JSON (`title`, `dateTime`, `venue`, `eventUrl`). | Online events, and rows whose venue is outside the region. Query strings such as `?location=` are disallowed by Meetup's `robots.txt` and are not used. |
| Empire Theatre | [What's on](https://www.empiretheatre.com.au/whats-on). schema.org `Event` data when the page includes it, otherwise the show cards. | `www` `robots.txt` redirects to the apex host; that redirect is followed. `/search` is disallowed and is not requested. |
| Moshtix | The public search [query=toowoomba](https://www.moshtix.com.au/v2/search?query=toowoomba). | Venues outside the Toowoomba region. The page is skipped when `robots.txt` cannot be read. |
| UniSQ | [UniSQ events](https://www.unisq.edu.au/events), including the event list that page loads. | Rows whose location does not include Toowoomba. Ipswich, Springfield, Brisbane, and online rows are left out. |
| Community groups | [Toowoomba International Multicultural Society events](https://www.tims.org.au/events) and [Toowoomba Malayali Association events](https://toowoombamalayali.org/events). | Squarespace disallows `?format=json` and `?format=ical`, so the HTML page is used. |
| Garage sales | [Buy Search Sell, Toowoomba garage sales](https://www.buysearchsell.com.au/toowoomba/buy-sell/garage-sales/). `robots.txt` allows that path and asks for a 5 second crawl delay. | Facebook and Instagram are never fetched. Gumtree is used only when `robots.txt` is readable and allows the path; a block is recorded and the run continues. |

## Moderate a submission

Submissions are not published by the form or by the collector.

1. Someone uses [Share something](share.html). The form posts to `https://formsubmit.co/whatsontoowoomba@agentmail.to` with `_captcha` enabled and `_template` set to `table`, then FormSubmit sends them to the thanks page.
2. Aneesh reads the email and checks the listing.
3. For an approved listing, add an object to the `items` array in `data/submissions.json` and commit it to `main`:

```json
{
  "items": [
    {
      "status": "approved",
      "kind": "event",
      "title": "Title from the email",
      "start": "2026-11-19T10:00:00+10:00",
      "end": null,
      "allDay": false,
      "venue": "Venue",
      "suburb": "Toowoomba City",
      "address": "Street address",
      "price": "Free",
      "ageGroups": ["families"],
      "communities": ["multicultural"],
      "categories": ["education"],
      "sourceUrl": "https://example.com/original",
      "items": "",
      "summary": "Short public description"
    }
  ]
}
```

`kind` is `event`, `garage`, or `notice`. Only rows with `"status": "approved"` are shown. `ageGroups`, `communities`, and `categories` use the ids in `scripts/pure.mjs` (`kids`, `teens`, `young-adults`, `adults`, `seniors`, `families`, `indian`, `filipino`, `african`, `pacific`, `chinese`, `korean`, `latin`, `indigenous`, `multicultural`, `music`, `sport`, `faith`, `markets`, `arts`, `education`, `free`, `garage`). Garage sales need `items`. Leave a row out, or set another status, to keep it off the site.

## Enable GitHub Pages

1. Open the repository on GitHub and go to Settings, then Pages.
2. Under Build and deployment, set Source to Deploy from a branch.
3. Choose branch `main` and folder `/` (root). Save.
4. The site is published at `https://aneesh15here.github.io/toowoomba-whats-on/`.

The share form's fallback thanks URL points at that address. On the live site, the page script sets `_next` from the address you are actually on.

## Things to do

Evergreen places live in `data/things-to-do.json`. The home page and [Things to do](things-to-do.html) read that file. Each place needs a name, an area, a short summary, a `type` from the `types` list, and an `https` link to an official page (council, parkrun, Queensland Parks, or a tourism page). Optional `suburb`, `streetAddress`, `postcode`, `venue`, `recurrence`, and `schemaType` fields are used by the generated place pages. Edit the JSON to add or correct a place. The collector does not write this file. `things-to-do.html` is the list people open. `/things-to-do/` points at that same list so the directory of place pages does not replace it.

## Photographs

Pictures in `assets/img/` are local copies of freely licensed Toowoomba photographs. They are not hotlinked. Event cards do not use them: `data/events.json` has no image fields, so a card shows a category colour block unless a listing carries a local `image` path under `assets/img/`. Full photographer, licence, and source links are on [credits.html](credits.html) and in the home page footer.

| File | Place | Photographer | Licence |
| --- | --- | --- | --- |
| `picnic-point-lookout` | Picnic Point lookout | Josselin Berger | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `flower-festival` | Carnival of Flowers, Queens Park Botanic Gardens | Kgbo | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `laurel-bank-park` | Laurel Bank Park | Heritage branch staff | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `city-hall` | Toowoomba City Hall | Shiftchange | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `empire-theatre` | Empire Theatre | James Newport | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
