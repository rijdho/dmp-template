# Actionable DMP

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23498569.svg)](https://doi.org/10.5281/zenodo.23498569)

**Write a data management plan as a machine-actionable file, and check what the plan says
about each dataset against the dataset's DOI record.**

The questions are the six core requirements of Science Europe's *Practical Guide to the
International Alignment of Research Data Management* (2021). The answers, and a list of the
project's datasets, become `dmp.json`, a plan that validates against the RDA DMP Common
Standard v1.2 as published. A checker then looks up each dataset's DOI and, where
DataCite holds its record, compares the record with the access, licence, repository and grant
the plan names; from a dataset's planned publication date on, a disagreement fails the build.
Writing a plan touches no network at all; checking one talks to DataCite and, for a DOI
DataCite does not hold, to doi.org.

For researchers, data stewards and funders who want to compare a plan with what was deposited.

🔗 **Live:** <https://rijdho.github.io/dmp-template/>. To use it offline, [`demo.html`](demo.html)
is the whole page in one file: download it and open it in a browser, no server needed.

Available in **English**.

It is the sibling of Actionable SMP, which does the same for software management plans
against a software repository.

## What it does

- **Write the plan.** Answer the fifteen questions, with Science Europe's guidance under each,
  fill in the project and its grant, and list the datasets: DOI, access, publication date,
  repository, licence, formats. Optional detail under each question and dataset fills the
  other maDMP fields: metadata standards and their language, quality measures, backup,
  certification, tools, people, costs, and a licence start date, which marks an embargo when it lies in the future.
  Download the result as `dmp.json` and as `DMP.md` for people, either in Science Europe's six
  sections or with the same answers filed under the sections of the Horizon Europe DMP template.
  Which question goes under which Horizon Europe section is this tool's reading
  (`HE_SECTIONS` in [`src/requirements.js`](src/requirements.js)); three of its sections
  (interoperability, other research outputs, other issues) have no question, and the file
  says so.
  Any plan in maDMP v1.2 opens in the editor (tried with the standard's ten published examples).
- **Check the plan.** For each dataset with a DOI, read its record from DataCite and compare it
  with the plan. Also list the deposits DataCite holds under the plan's grant that the plan
  does not mention. The result downloads as a Markdown report, the same one CI writes.
- **Keep versions.** Save the plan as a numbered version with a note at each milestone; the
  history travels in the file. Compare two versions, or a version with the plan being edited,
  to list every change to an answer, a dataset or a field the page edits, with publication
  dates that moved later first.
- **Check in CI.** The same checker runs from the command line and as a GitHub Action, so a
  project repository that carries its plan can check it on a schedule.

The numbers it reports first are the distance between two levels: how many of the required
questions the plan *answers*, and how many of its datasets their DOI records *confirm*.

## The method

### Questions

The guide states six core requirements in fifteen questions (1a to 6b), which it sets out as
the minimum every research funder should ask a DMP to cover. There are no levels. The guide
states the questions twice, as the core requirements (pp. 8-9) and again in an example template
(pp. 16-25), and seven of the fifteen are worded differently in the two places (1b, 2a, 3a, 4a,
4c, 5b, 5c). In 4c the template asks "What ethical issues and codes of conduct are there"
instead of how they will be taken into account. This tool uses the core requirements' wording,
and the template's guidance under each question. `tests/i18n.test.mjs` pins both.

### Required and optional

All fifteen questions are required, with two conditions. 4a carries its own ("If personal data
are processed") and is required when a dataset holds personal data; 4c, on possible ethical
issues, is treated alike and required when the plan says there are ethical issues. Both are
required while the answer is still `unknown`. What is optional is
detail: the maDMP fields that hold the structured part of an answer, folded under the question
or dataset they belong to. The page reports two states apart, a *valid maDMP* (which a draft
can be from the start) and a *complete* plan (every required question answered).

### Versions

Saving a version adds `{ version, date, note }` to `dmp.actionable_dmp.versions`; maDMP itself
has no version number, only `modified`. Comparing two plans ([`src/diff.js`](src/diff.js))
matches datasets across versions by any identifier they share: a dataset keeps the local
identifier it had before its DOI in `alternate_identifier`, so it is still recognised once the
DOI is added. To make a version citable, deposit it where deposits are versioned, such as
Zenodo, and record the DOI as the plan's `dmp_id`. A plan kept in a git repository is also
versioned by git, and the Action can check it on every push.

### Claims and plans

maDMP has no status field and this tool does not add one: the plan's own dates decide. A
dataset whose `issued` date (on its distribution, else on the dataset) is today or earlier is
said to be published, so a disagreement between the plan and its record fails the check. A
dataset whose date is ahead, or that has none, is planned, and the same checks are reported as
*not yet*.

### What is compared

| Check | Plan (maDMP field) | DOI record (DataCite) |
|---|---|---|
| Identifier of the plan | `dmp_id` (DOI, Handle, ARK or URL) | a DOI exists, at DataCite or, through doi.org, at another agency |
| Persistent identifier | `dataset_id` | the DOI is findable at DataCite; one registered elsewhere is confirmed through doi.org, its record not compared |
| Access | `distribution.data_access` | the info:eu-repo access term: open; shared as restricted or embargoed; closed as closed or restricted |
| Licence | `distribution.license.license_ref` | `rightsList`, compared by normalised URL and SPDX id |
| Repository | `distribution.host.url` | the host of the landing page the DOI resolves to |
| Formats | `distribution.format` | `formats`, with file extensions and MIME types treated as the same |
| Grant | `project.funding.grant_id` | `fundingReferences.awardNumber` or `awardUri` |
| Creators | ORCID iDs in `dataset.creator` | the creators' name identifiers |

Per dataset the checker reports one verdict: *confirmed*, *does not match*, *not yet* or
*declared only* (nothing on the record could confirm or refute the plan).

### The file

`dmp.json` validates against [`schema/maDMP-schema-1.2.json`](schema/maDMP-schema-1.2.json),
the standard's own schema, carried unchanged (a test pins its hash, which matched the upstream
file on 2026-10-20).
The standard allows deployments to add fields; this tool adds one, `dmp.actionable_dmp`, for
the fifteen answers, described by [`schema/dmp.schema.json`](schema/dmp.schema.json), which is
generated from `src/requirements.js`. Validation asserts `format` (dates, e-mail, URLs), which
JSON Schema 2020-12 leaves as an annotation, and adds checks of its own: DOIs, the ORCID check
digit, `modified` not before `created`, one DOI per dataset.

Run against the ten examples published with the standard, the schema finds one error (example
10 gives a bare DOI where `host.url` asks for a URL) and the ORCID check finds a placeholder
iD in all ten. `tests/plan.test.mjs` pins those findings.

### Architecture

```
src/requirements.js   the catalogue: questions, sections, maDMP paths, dataset fields (single source of truth)
src/jsonschema.js     a validator for the keywords the maDMP schema uses
src/madmp-schema.js   the vendored maDMP schema as a module (generated)
src/plan.js           create, validate, finalise, write dmp.json and DMP.md
src/evidence.js       the checks, against any "registry view"
src/datacite.js       a registry view over the DataCite REST API
src/diff.js           what changed between two versions of a plan
src/report.js         the result as text or Markdown, shared by the CLI and the page
bin/dmp-check.mjs     the command-line checker; action.yml wraps it
src/app.js            the page: moves values between the DOM and the modules above, nothing more
```

No build step, no runtime dependency. The page is `index.html` plus ES modules served as they
are; every relative import carries the same `?v=N`, and `tests/assets.lock.json` fails the suite
when a served file changes without the number moving.

### Related work

DMPonline, DMPTool, Argos, RDMO and the Data Stewardship Wizard are tools for writing plans;
DMPTool also registers DOIs for them at DataCite. The RDA DMP Common Standard working
group defined the format. This tool reads the plan back against the DOI registry, dataset by
dataset, and says where the two disagree.

## Using the checker

```bash
node bin/dmp-check.mjs [dmp.json] [--strict] [--offline] [--no-unlisted] [--today YYYY-MM-DD] [--format text|md|json]
```

Exit code 0 when the plan is valid and every dataset due by today matches its record, 1 when
not (with `--strict`, planned datasets count too), 2 for usage errors, 3 when DataCite could
not be read. `--offline` only validates.

As a GitHub Action (pinned to `main` until there is a tagged release):

```yaml
- uses: actions/checkout@v4
- uses: rijdho/dmp-template@main
  with:
    plan: dmp.json     # default
    strict: false      # default
    offline: false     # default
```

The report is also written to the run's summary page.

## Examples

[`examples/open-data.json`](examples/open-data.json) and
[`examples/personal-data.json`](examples/personal-data.json) are complete, valid plans with
every question answered. Their content is synthetic, their DOIs use DataCite's test prefix
10.5072, and their contact is Josiah Carberry, ORCID's fictitious test researcher.

## Tests

```bash
node --test tests/*.test.mjs
```

Dependency-free, on Node's built-in runner, and no test touches the network: DataCite is
replaced by records held in memory, shaped as the API returned them for Zenodo and Figshare
deposits on 2026-10-20. Three layers: the method (validation, every check with exact expected
outcomes, the claim and plan dates, deposit grouping), the checker end to end with its exit
codes, and the page's guards (the CSP, cache-busting, the house style copy, the vendored
schema's hash, every key the page builds at runtime, the guide's wording).

## Run locally

```bash
python3 -m http.server 8000     # any static server; then open http://localhost:8000
node scripts/build-demo.mjs      # regenerate demo.html after changing any served file
node scripts/build-schema.mjs    # after changing src/requirements.js or src/plan.js
node scripts/sync-house.mjs      # after the house style changes
```

## Caveats

- **A matching record is not good data management.** The check stops a plan from claiming a
  deposit, a licence or an access level that the registry does not show. It cannot say whether
  the data are documented, usable or the right data to keep.
- **Records are read from DataCite only.** A DOI registered by another agency, such as
  Crossref, is confirmed to exist through doi.org, but its record is not compared with the
  plan. Handles, ARKs and URLs are reported as declared only.
- **Records can be silent.** The Zenodo records from 2026 read while building this tool listed
  no formats and stated no access term, although some older Zenodo records state one. Silence on
  access or formats is reported as not checkable; a record with no licence or no funding counts
  as missing, because a deposit that should carry them does not.
- **The access mapping is ours.** maDMP's open, shared and closed are matched to the
  info:eu-repo terms as stated in the table above.
- **Answers are only counted.** A question counts as answered when its answer is not
  empty.
- **The list of unlisted deposits is partial.** At most 100
  records are read per grant, only deposits whose funding records the grant number are found,
  and deposits by other partners of the same project are included.

## License

Copyright 2026 Ricardo Hartley Belmar. The code is under [MIT](LICENSE); the extension schema,
the examples and the texts are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The guide's questions and guidance are used under CC BY 4.0 from Science Europe (2021),
<https://doi.org/10.5281/zenodo.4915862>; the maDMP schema is in the public domain. The code was
published under Apache-2.0 up to commit 635778c (2026-10-20), and copies taken then keep that
licence. [`NOTICE`](NOTICE) carries the details.

## Citation

If you use this tool, please cite it: see [`CITATION.cff`](CITATION.cff) or the "Cite this
repository" button. Archived on Zenodo: concept DOI
[10.5281/zenodo.23498569](https://doi.org/10.5281/zenodo.23498569) (always resolves to the latest version).
