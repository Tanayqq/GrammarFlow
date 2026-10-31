# Dev Editor — Python beta

Execution update: all 12 listed languages can now run. Python snippets up to
12,000 characters retain the local recorded trace. Other languages and longer
Python programs use Judge0's separate compilation/execution service. Clicking
Run on Judge0 sends the source and test inputs to that service; never include
secrets. Only single-file, standard-runtime programs are supported. Java uses
class Main. Remote results show real stdout, stderr and compiler diagnostics;
they do not include variable snapshots or a fabricated execution timeline.

Runs are bounded to 2 CPU seconds, 5 wall-clock seconds, 256 MB of memory and
bounded file/output sizes, with a 25-second server deadline including queueing.
Networking is disabled in the submitted job. Stop aborts waiting, but a remote
job already submitted can finish within its limits. No source is executed on
Render or Vercel. Keys, if a dedicated provider is configured later, remain
server-side. Remote runs have a separate limiter from AI explanations and do
not spend AI credits. The shared external service has no availability or
unlimited-capacity guarantee; use a dedicated instance as traffic grows.

The real execution smoke check passed all 12 language examples. Unit checks
cover fixed runtimes, network/time limits, input/output bounds, compiler and
runtime errors, provider failures and safe messaging.

Official execution API reference: https://ce.judge0.com/

Multilanguage source explanations: Python, JavaScript, TypeScript, Java, C,
C++, C#, Go, Rust, PHP, Ruby and SQL. Select the language, paste code, then
choose an overview, a specific line, or a 10-line batch. Previous/Next change
the selected range; only clicking Explain makes an AI request. Cached answers
replay without a new request. Changing language preserves the draft; Load
language example explicitly replaces it.

Explanations accept up to 1,000 lines / 60,000 characters, with at most 1,000
characters per line. Source over 12,000 characters uses a bounded excerpt
around the requested lines, plus nearby/top-level context. The result states
this limitation: it cannot establish whole-program behaviour or understand
dependencies outside the excerpt. Every requested line must appear exactly
once in a batch response, including blanks and closing braces; malformed or
wrong-language responses are rejected. AI narration can still be incorrect.

Recorded variable traces remain Python-only, with the original 12,000-character,
500-step and external timeout limits. Remote language execution returns output
and errors. Source explanations are separate from actual runtime observations.
Error help accepts captured compiler or runtime diagnostics in the selected
language; it does not apply fixes or automatically run generated code.

`node test-multilang.cjs` checks all 12 prompts/examples, 1,000-line pagination,
bounded context, line-coverage validation and cache behaviour. The real Chrome
workspace check also covers language controls, long-source navigation and mobile
layout, using a synthetic API response for UI testing. Four separate live
provider samples cover JavaScript, Java line 200, C++ Hinglish, and Python lines
991–1000; these are examples, not proof of accuracy for arbitrary programs.

Release preparation (2026-10-31): `node build-public.mjs` generates only the
allowlisted app assets under `public/dev-editor/`. Vercel runs this automatically.
The runtime is hosted separately at https://grammarflow-python-runtime.vercel.app
and contains only static files and upstream notices. No keys, user data or APIs
are deployed there. `package-release.mjs` validates the pinned runtime hashes.
The public AI route `/api/v1/dev-editor/assist` uses the existing application
limiter and provider service; its key stays on Render.

Real Chrome verification of the packaged app against the HTTPS runtime passed
all 26 cases. Workspace execution and final-step output also passed. All 67
application tests pass with the isolated Docker service. CodeRabbit raised one
minor portability issue with the browser report path; it was corrected to use
the ignored local `release/` directory. Deployment status must be checked after
each push; these results do not establish universal browser compatibility.

Open http://127.0.0.1:8786/dev-editor.html for Python editing, numbered lines,
examples, test inputs, execution snapshots, timeline playback, variables,
arrays, stack, stdout and captured errors. English/Hinglish template narration
and replay make no AI requests.

## Start

Run setup-runtime.ps1 if vendor/ is missing, then run `node serve.mjs` here.
The pinned Pyodide files are hash-checked and ignored by Git. UI port 8786
and static runtime port 8787 bind only to loopback. Never expose this local
server publicly. Nothing runs automatically from a link.

Optional Explain, Explain line and Fix my error call Groq through /assist
only after a click. The local server reuses the existing private Groq setup;
no key is served to the browser. Code and at most 12 selected observations
are sent to the provider. Do not include secrets. AI can make mistakes.
Responses use bounded output, cache reuse and one bounded format/language
repair; replay does not consume credits.

## Limits and isolation

The opaque iframe allows scripts without allow-same-origin. Its blob worker
inherits a restrictive CSP; connections are restricted to the separate static
runtime origin. Network constructors are removed after startup as additional
protection. No app credentials enter the runner. Results render as text.

Runs allow 12,000 code characters, 50 input lines, 500 events, 1 MB of step
data and 4,000 output characters plus a truncation marker. Exact built-in
previews are bounded by depth, item count and length; custom repr is not used.
Startup has a 45-second deadline and execution a 3-second external deadline,
with an independent parent fallback. Stop destroys the iframe.

Line snapshots describe state BEFORE the named line. causedBy identifies the
previous observed line in that frame, not a unique semantic cause. Return and
exception events capture final state. Only the user's filename is traced.

Python introspection can interfere with its own trace. These are teaching
aids, not tamper-proof evidence. Limits cannot guarantee a hard browser memory
ceiling. No third-party package installation or network workloads are supported.
The separate runtime origin and browser checks do not provide a hard memory
ceiling; users should run their own small snippets rather than hostile code.

## Verification status — 2026-10-31

- Isolated Docker application regression: 66 passed, 0 failed; see ../TESTING.md.
- Saved browser suite: 26/26 passed, 2,440 snapshots validated. The saved report
  was rechecked today; the browser suite was not rerun today.
- UI interaction, AI-adapter and forged-message protocol checks pass.
- Nine recorder test groups pass in desktop Python and real Pyodide, including
  caught output-limit errors. External long-computation termination and recovery
  pass. Node runtime checks do not establish browser CSP isolation.
- Six synthetic 100-line AI cases previously returned usable responses; this is
  bounded evidence, not a general accuracy benchmark.
- CodeRabbit's latest review raised three minor issues: UTF-8 request decoding,
  repeated writes after output truncation, and stale documentation. All were
  corrected and the recorder/runtime checks rerun. Future code changes should
  include CodeRabbit review, as requested by the user.

Run `node check-browser-report.mjs` to inspect the saved browser report.
Verification reports contain fixed synthetic cases only; custom trace code is
not saved. Both local POST routes require exact same-origin JSON requests and
bounded bodies. The static runtime origin has no AI or report endpoint.

Earlier 16/16 and 20/20 reports were intermediate historical runs, superseded
by the 26-case report. Broader browser/device coverage and public deployment
remain pending. No production account or payment integration was changed.

Preserve upstream Pyodide and Python notices when distributing runtime files.
Official references:
https://pyodide.org/en/stable/usage/webworker.html
https://pyodide.org/en/stable/usage/downloading-and-deploying.html
