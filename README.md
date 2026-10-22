# What's On Toowoomba

A free static calendar of events, garage sales, and community notices in Toowoomba, Queensland. The site is plain HTML, CSS, and JavaScript. It reads `data/events.json`. GitHub Pages can host it from this repository with no server and no paid hosting.

## How it works

1. `scripts/collect.mjs` fetches public listing pages that allow automated reads.
2. It normalises each listing, tags age group, community, and category with keyword rules, drops anything outside the Toowoomba region or already finished, and dedupes matches.
3. It writes `data/events.json` only when the listings changed. A source that errors keeps its previous listings. A source that is skipped or returns nothing contributes nothing new.
4. The page merges that file with rows in `data/submissions.json`. Community listings are published by an hourly check of the admin inbox, not by hand. Past listings stay hidden, and a reported row stays hidden.
5. GitHub Actions runs the collector at 6:00 and 18:00 Australia/Brisbane (`0 20 * * *` and `0 8 * * *` UTC) and when someone starts the workflow by hand. A second workflow publishes community submissions at 15 minutes past every hour. Both use the default `GITHUB_TOKEN` with `contents: write` only.

Filters on the calendar:

- Age group: Kids 0-12, Teens 13-17, Young adults 18-30, Adults, Seniors 60+, Families/All ages
- Community: Indian, Filipino, African, Pacific Islander, Chinese, Korean, Latin American, Indigenous/First Nations, Multicultural/All
- Category: music, sport, church/faith, markets, arts, education, free events, garage sales
- Date: today, this weekend, this week, this month

Each card shows the title, date and time, venue, price or free, and a link back to the source. Garage sales have their own tab with date, suburb or address, and items.

If a run finds nothing upcoming, the page shows an empty state. The collector does not invent listings.

Run it locally with Node 22:

```bash
npm install
node scripts/collect.mjs
npm test
```

Publishing submissions needs `AGENTMAIL_API_KEY` in the environment. Without it, the command leaves `data/submissions.json` alone:

```bash
npm run publish-submissions
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

## Community submissions

Submissions are published by the hourly workflow. There is no manual approval step.

1. Someone uses [Share something](share.html). The form posts to `https://formsubmit.co/whatsontoowoomba@agentmail.to` with `_captcha` enabled, a honeypot, and `_template` set to `table`, then FormSubmit sends them to the thanks page.
2. `.github/workflows/publish.yml` lists messages in that inbox whose subject contains `What's On Toowoomba`, reads each new message with the AgentMail API, and validates it.
3. A valid event, garage sale, or notice is appended to `data/submissions.json` with `"status": "published"`. The workflow commits that file. The name and email from the form stay in the inbox only. They are not written into the file.
4. The calendar shows rows with `"status": "published"` (and any older `"approved"` rows) that still have a location, are not finished, and, for a garage sale, have an items list. Events and garage sales must have a start time. Notices can be all day.

Required fields:

| Kind | Location | Start time | Items |
| --- | --- | --- | --- |
| Event | yes | yes | no |
| Garage sale | yes | yes | yes |
| Notice | yes | no | no |

The location has to be in the Toowoomba region. A date is required for every kind so a finished listing can expire. The publisher removes past rows on each run.

Spam checks, all in `scripts/submissions.mjs`:

- Honeypot: `_honey` is FormSubmit's field. `hp_field` must be empty or the message is rejected.
- Sender: the From address must be on `formsubmit.co`. Mail from anywhere else is left unhandled, so a later run can accept it if `SUBMISSION_FROM_SUFFIX` is changed.
- Length limits match the form (`title` 200, `message` 2000, `items` 1000, and the other `FIELD_LIMITS`).
- More than two links in the listing text, a title that is only a link, or a shortener host is rejected. `source_link`, when present, must be an `http` or `https` URL.
- A small profanity and spam-word list rejects the listing.
- The same kind, title, day, and place is not added twice. A hidden listing cannot be put back by sending it again. A listing already collected from a public source is skipped, and that email is tried again on a later run if the collected copy has gone.
- A listing that has already finished is not added. Later runs delete finished rows.

`kind` in the file is `event`, `garage`, or `notice`. `ageGroups`, `communities`, and `categories` use the ids in `scripts/pure.mjs`.

### Secret the owner must add

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `AGENTMAIL_API_KEY` | Repository secret | yes | Lets the hourly workflow read the inbox `whatsontoowoomba@agentmail.to` and send the hide confirmation. Create the key in the AgentMail organization that owns that inbox. |
| `SUBMISSION_FROM_SUFFIX` | Workflow env | no | Defaults to `formsubmit.co`. Change it only if FormSubmit's sending domain changes. |

Until `AGENTMAIL_API_KEY` is set, the workflow exits without changing `data/submissions.json` and submissions stay in the inbox. FormSubmit must already be confirmed for that address. No paid host, database, or login is added. The site stays on GitHub Pages from `main`.

### Flagging

Every community submission with an id shaped like `sub` plus 16 hex characters has a Report control. Collected listings do not.

One report hides the listing. The report form posts to the same FormSubmit address with the subject `What's On Toowoomba FLAG: <id>`. That email is the admin notification. On the next publish run the row's `status` becomes `"hidden"`, `reportCount` becomes `1`, and the workflow sends one more message to `whatsontoowoomba@agentmail.to` with the subject `What's On Toowoomba HIDDEN: <id>`. The listing drops off the calendar. The row stays in `data/submissions.json` so it can be restored.

A report does not hide the row when the honeypot is filled, the reason is over 500 characters, the listing id does not match, the id is unknown, or the sender is not FormSubmit. A second report on a hidden row does not send another hide confirmation.

To show a hidden listing again, set `"status": "published"` in `data/submissions.json` and commit it to `main`. A later report hides it again. Deleting the row removes it. Finished rows are deleted by the publisher whether or not they were hidden.

Contact the admin inbox from the footer, or from the Contact admin section on the share page: `whatsontoowoomba@agentmail.to`.

## Enable GitHub Pages

1. Open the repository on GitHub and go to Settings, then Pages.
2. Under Build and deployment, set Source to Deploy from a branch.
3. Choose branch `main` and folder `/` (root). Save.

The `CNAME` file serves that site at `whatsontoowoomba.au`. The share form sets its thanks address in the browser from the page you are on, so the repository does not hard-code a personal Pages URL.
