**Performance Dashboard — Product Brief**

**Owner:** John Higgins

**Status:** Draft v0.1 — distilled from dictated working notes

**Audience:** Self

# 1. Vision

A centralised, server-agnostic test orchestration and data-capture platform for 7thSense media servers (S/P/R/W-Series and successors). It runs structured performance tests with minimal human intervention, captures every relevant configuration and result parameter automatically, and persists results to a central, schema-stable database.

The data underpins two downstream uses:

- Ongoing qualification of current and future hardware generations.

- An internal sales configurator that maps customer requirements to recommended server specifications — fed by, but separate from, this tool.

# 2. Goals and Principles

- **Eliminate human error in test parameter capture.** If a value can be queried from the system under test, it must never be typed by a person.

- **Cross-platform consistency.** Results from an S-Series, P-Series, R-Series, or W-Series test must be directly comparable.

- **Schema durability.** The data model must survive hardware-generation changes (motherboard, GPU, capture card, OS) without breaking.

- **Minimum effective intrusion.** Tooling running alongside the server under test must not skew the test.

- **Live monitoring and retrospective analysis.** Real-time state during a run; full review afterwards.

- **Single source of truth.** All test data flows to one persistent store; Jira tickets, Dropbox archives, and the future configurator all read from or link to it.

- **(Future) Selectable to run testing on Delta Media Server or Actor Media Server.** Current near-term target is Delta Media Server, Actor is a future requirement

# 3. Personas

- **Test engineer (primary):** runs ad hoc and structured tests; exploration of hardware performance limits, needs guided pre-checks, live monitoring, unambiguous pass/fail signals, static testing location at a company facility on the company network.

- **Production Engineer:** runs pre-delivery tests; needs guided pre-checks, live monitoring, unambiguous pass/fail signals, static testing location at a company facility on the company network.

- **Systems Engineer:** runs ad hoc tests; needs guided pre-checks, live monitoring, unambiguous pass/fail signals, ad hoc location, may or may not be connected to a company network.

- **Sales engineer (downstream, future):** doesn’t use this tool directly; consumes its data via the separate (yet to be implemented) server configurator.

- **Future analyst / AI agent:** queries historical results to answer cross-cutting questions (e.g. “highest 4K60 channel count ever achieved on a given server/GPU/disk configuration”).

# 4. Functional Scope

## 4.1 Test orchestration

- Pre-test checklist with go/no-go status indicators per item.

- Connect to server under test; persistent header shows connection state and polling rate.

- Direct control of Delta/Actor playback from the dashboard: play, stop, rewind to zero, drop-frame counter clear.

- Timeline construction from the dashboard: drop media in, set test duration (e.g. 24hr), tool issues the necessary Delta external-control commands to loop media to fill the duration.

- Multi-server orchestration: run, monitor, and control tests on multiple servers simultaneously (typical 1-3, max 10).

## 4.2 Automated parameter capture

- Server identity (model, serial).

- OS version, driver versions (GPU, capture card, NIC, etc.), Delta software version.

- Registry diff against a default-registry baseline asset stored per server type.

- Hardware configuration: GPU, capture cards, motherboard, RAM, drive complement, video format (e.g. RGB/YCrCb).

- Movie drive configuration.

- Media on timeline: which file(s), per-output assignment, total canvas resolution, frame rate, bit depth, media bandwidth, codec.

- Test profile data folded into auto-captured fields wherever possible (current “Test Profile” tab deprecated).

## 4.3 Real-time monitoring

- Per-server live view: replication of current Delta on-screen debug stats, graph, frame drops, media and video bandwidth, connection state, polling rate.

- Frame-drop fidelity: investigate improvements to enable per frame data export from Delta; read on a buffered stream so display fidelity is not capped by the current 1–2 s poll tick. Current graph view update interval misses frame timing spikes as graph update is significantly slower than frame time. Note, cannot impact SUT performance

- Pass/fail traffic-light state (green / amber / red), live-updating against configurable thresholds.

- Multi-server summary page: all running tests visible in one view, switch to view any.

- *(Stretch)* Mobile companion view (iOS/Android) for the summary page.

## 4.4 Pass/fail logic

- Configurable thresholds (e.g. dropped frames per million, dropped frames per hour).

- Three states: pass, tentative pass, fail.

- *Tentative pass* supports runs cut short but trending positive.

## 4.5 Logging and data export

- Decision required: full per-sample log vs structured summary. Recommendation in section 6.

- Real-time write of test data to a file on the server under test (or test controller), with proven zero performance impact.

- On test completion: payload pushed to central store, copy linked into the originating Jira ticket, raw data archived to Dropbox.

## 4.6 Data persistence

- Central database (recommendation: a proper schema-versioned relational store — see section 6).

- Schema designed for cross-generation queries (highest channel count, best disc bandwidth, etc.), independent of which specific hardware was present.

## 4.7 After-action review

- Full-test graph zoom-out with intelligent decimation: average where data is flat; preserve every transient (frame drop, spike) at full fidelity.

- Cluster analysis: are drops time-correlated, periodic, or isolated?

## 4.8 Visualisation

- Persistent header showing connection state per connected server.

- Tab structure rationalised. Current four tabs (Session, Service Status, Test Profile, Registry Diff) overlap and conflate phases. Replace with **Pre-test / Live / Post-test** sections per server, plus a multi-server overview.

- **Radar/spider chart** for cross-server performance comparison: each axis a normalised metric, each chart a server. Closer-to-edge = more capable - chart *shape* characterises the server’s profile.

## 4.9 Integrations

- **Jira:** link test runs to test-request tickets; pull scenario from ticket into a test-prep page; push result summary back. *Open question: is Jira still the right system for test requests?*

- **Dropbox:** archive raw test data; ticket holds the link

- **Libra hardware monitor:** read-only / cut-down ingestion; no writes; footprint validated as non-disruptive.

# 5. Out of Scope (this product) / Future Phases

- **Configurator tool.** Separate application that consumes the central database. Internal sales-facing; not customer-exposed. Depends entirely on the data model defined here being stable across hardware generations.

- **AI assistant.** Two distinct use cases: (a) natural-language querying of the historical database; (b) guided test setup. Engine choice (internally hosted vs Copilot agent vs cloud API) unresolved and partly governed by data-handling policy. Defer until the data layer is mature and known-stable.

# 6. Key Decisions and Open Questions

| **#** | **Decision** | **Recommendation / Status** |
| --- | --- | --- |
| 1 | Spreadsheet vs proper database for central store | Proper database (e.g. PostgreSQL). A spreadsheet will not survive schema evolution across hardware generations and will block the configurator. |
| 2 | Logging granularity (full sample log vs summary) | Both. Full per-sample log to file on the test machine for forensic use; structured summary record to the central DB. Do not ship raw sample logs into the central DB. |
| 3 | Jira as test-request system | Retain for now — traceability is effectively free. Revisit only if request volume justifies a custom queue. |
| 4 | Real-time data export from Delta — listener vs file-tail | Speak with Matt J before committing. Validate zero performance impact on the server under test. |
| 5 | Graph fidelity at frame rate | Need to do this as current graph doesn’t capture spikes in timing as sample period is low vs frame time. |
| 6 | UI framework — supports collapsible side panels and nested per-server tabs at scale? | Confirm before committing to the 4.8 redesign. |
| 7 | AI hosting model | Defer; not blocking. |

