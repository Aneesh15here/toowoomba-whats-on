# What's On Toowoomba

A free static calendar of events, garage sales, and community notices in Toowoomba, Queensland. The site is plain HTML, CSS, and JavaScript. It reads `data/events.json`. GitHub Pages can host it from this repository with no server and no paid hosting.

## How it works

1. `scripts/collect.mjs` fetches public listing pages that allow automated reads.
2. It normalises each listing, tags age group, community, and category with keyword rules, drops anything outside the Toowoomba region or already finished, and dedupes matches.
3. It writes `data/events.json` only when the listings changed. A source that errors keeps its previous listings. A source that is skipped or returns nothing contributes nothing new.
4. The page merges that file with approved rows in `data/submissions.json`. Past listings stay hidden.
5. GitHub Actions runs the collector at 6:00 and 18:00 Australia/Brisbane (`0 20 * * *` and `0 8 * * *` UTC) and when someone starts the workflow by hand. The workflow uses the default `GITHUB_TOKEN` with `contents: write` only.

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
| Toowoomba Regional Council | Public event pages under [Events and special days](https://www.tr.qld.gov.au/Places-and-activities/Things-to-see-and-do/Events-and-special-days) on tr.qld.gov.au. `robots.txt` allows those paths. | [Visit Toowoomba Region](https://visit.tr.qld.gov.au/) (`events.tr.qld.gov.au` redirects there) often blocks cloud networks before a listings page is returned. The run records that and continues. |
| Toowoomba Region Libraries | Dated sessions on council program pages, including [First 5 Forever](https://www.tr.qld.gov.au/Places-and-activities/Libraries/Library-programs-and-events/First-5-Forever-and-0-5-year-sessions). | The Spydus catalogue at `toowoomba.spydus.com` disallows all robots, so it is not fetched. |
| Eventbrite | The public Toowoomba destination page, up to four result pages: [all events](https://www.eventbrite.com.au/d/australia--toowoomba/all-events/). | `/api/v3/destination/events/` is disallowed by Eventbrite's `robots.txt` and is not requested. Online and out-of-region rows are dropped. |
| Humanitix | The public search page [Australia / Toowoomba](https://humanitix.com/au/search/australia/toowoomba). `robots.txt` allows it. | Rows whose address is outside the region, and cancelled listings. |
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
